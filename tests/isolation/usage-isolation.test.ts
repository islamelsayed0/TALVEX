import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  CLAIM_SHAPES,
  createMemberClient,
  createServiceClient,
  memberToken,
  preflight,
  type ClaimShape,
  type TestClient,
} from './local-stack'

// Isolation proof for usage metering (F11, migration 012), extending the
// suite per CLAUDE.md rules 2 and 8. The usage screen aggregates over
// chat_messages, monitor_daily_rollups, and org_members through the org
// scoped client, and stores one new column, organizations.timezone. Rules
// under test, all enforced at the database:
//   - CROSS ORG: the aggregation reads (messages with token counts, rollup
//     check counts, membership rows) return only the caller org's rows; org
//     B's volumes are absent from every number an org A admin can compute.
//   - VISIBILITY WITHIN THE ORG: an org admin reads every conversation's
//     messages (so the admin only screen sees whole org usage); a member
//     reads only their own. The screen's admin gate is requireAdmin at the
//     route (exercised by the e2e spec); the data layer itself relies on
//     this RLS, which is what is proven here.
//   - TIMEZONE WRITE PATH: an org admin updates their own org's timezone; a
//     member's update matches zero rows; org B's admin cannot touch org A;
//     and the column grant reaches timezone alone, so even an admin cannot
//     rename the org or move clerk_org_id.
//   - FORMAT CONSTRAINT: the check constraint refuses a value that is not
//     shaped like an IANA zone, even from the service role.

const runId = randomUUID()
const seed = {
  orgA: { clerk_org_id: `org_usage_a_${runId}`, name: 'Usage Test Org A' },
  orgB: { clerk_org_id: `org_usage_b_${runId}`, name: 'Usage Test Org B' },
  adminA: `user_usage_admin_a_${runId}`,
  memberA: `user_usage_member_a_${runId}`,
  memberA2: `user_usage_member_a2_${runId}`,
  adminB: `user_usage_admin_b_${runId}`,
}

// Distinctive volumes so a cross org leak is unmistakable in any sum:
// org A holds 3 messages (100 in / 10 out tokens) and 11 checks; org B
// holds 5 messages (7000 in / 700 out tokens) and 999 checks.
const A_TOKENS = { input: 100, output: 10 }
const B_TOKENS = { input: 7000, output: 700 }

let service: TestClient
let orgAId: string
let orgBId: string
let seeded = false

const asUser = (clerkUserId: string, clerkOrgId: string, shape: ClaimShape) =>
  createMemberClient(memberToken({ clerkUserId, clerkOrgId, shape }))

async function seedOrgUsage(opts: {
  orgUuid: string
  clerkOrgId: string
  creator: string
  assistantMessages: number
  tokens: { input: number; output: number }
  checkCount: number
}): Promise<void> {
  // Conversation through the creator's own RLS session (the production
  // path); messages through the service role, exactly like the chat route.
  const { data: convo, error: cErr } = await createMemberClient(
    memberToken({ clerkUserId: opts.creator, clerkOrgId: opts.clerkOrgId, shape: 'legacy' }),
  )
    .from('chat_conversations')
    .insert({ org_id: opts.orgUuid, created_by: opts.creator, title: 'Usage seed' })
    .select('id')
    .single()
  if (cErr || !convo) throw new Error(`Seeding conversation failed: ${cErr?.message}`)

  const rows = [
    {
      org_id: opts.orgUuid,
      conversation_id: convo.id,
      role: 'user',
      content: 'usage seed question',
    },
    ...Array.from({ length: opts.assistantMessages }, (_, i) => ({
      org_id: opts.orgUuid,
      conversation_id: convo.id,
      role: 'assistant',
      content: `usage seed answer ${i}`,
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      input_tokens: opts.tokens.input,
      output_tokens: opts.tokens.output,
    })),
  ]
  const { error: mErr } = await service.from('chat_messages').insert(rows)
  if (mErr) throw new Error(`Seeding messages failed: ${mErr.message}`)

  // A monitor and one rollup day, written service side like the cron sweep.
  const { data: monitor, error: monErr } = await service
    .from('monitors')
    .insert({ org_id: opts.orgUuid, name: 'Usage Monitor', url: 'https://example.com' })
    .select('id')
    .single()
  if (monErr || !monitor) throw new Error(`Seeding monitor failed: ${monErr?.message}`)
  const { error: rErr } = await service.from('monitor_daily_rollups').insert({
    monitor_id: monitor.id,
    org_id: opts.orgUuid,
    day: new Date().toISOString().slice(0, 10),
    uptime_percent: 100,
    check_count: opts.checkCount,
  })
  if (rErr) throw new Error(`Seeding rollup failed: ${rErr.message}`)
}

beforeAll(async () => {
  await preflight()
  service = createServiceClient()

  const { data: orgs, error: orgErr } = await service
    .from('organizations')
    .insert([seed.orgA, seed.orgB])
    .select()
  if (orgErr || orgs.length !== 2) {
    throw new Error(`Seeding organizations failed: ${orgErr?.message}`)
  }
  orgAId = orgs.find((o) => o.clerk_org_id === seed.orgA.clerk_org_id)!.id
  orgBId = orgs.find((o) => o.clerk_org_id === seed.orgB.clerk_org_id)!.id

  const { error: memberErr } = await service.from('org_members').insert([
    { org_id: orgAId, clerk_user_id: seed.adminA, role: 'admin' },
    { org_id: orgAId, clerk_user_id: seed.memberA, role: 'member' },
    { org_id: orgAId, clerk_user_id: seed.memberA2, role: 'member' },
    { org_id: orgBId, clerk_user_id: seed.adminB, role: 'admin' },
  ])
  if (memberErr) throw new Error(`Seeding org_members failed: ${memberErr.message}`)

  await seedOrgUsage({
    orgUuid: orgAId,
    clerkOrgId: seed.orgA.clerk_org_id,
    creator: seed.memberA,
    assistantMessages: 2,
    tokens: A_TOKENS,
    checkCount: 11,
  })
  await seedOrgUsage({
    orgUuid: orgBId,
    clerkOrgId: seed.orgB.clerk_org_id,
    creator: seed.adminB,
    assistantMessages: 4,
    tokens: B_TOKENS,
    checkCount: 999,
  })

  seeded = true
}, 60_000)

afterAll(async () => {
  if (!seeded) return
  await service
    .from('organizations')
    .delete()
    .in('clerk_org_id', [seed.orgA.clerk_org_id, seed.orgB.clerk_org_id])
})

describe.each(CLAIM_SHAPES)('the aggregation reads are org scoped (%s claim shape)', (shape) => {
  it("org A's admin sums org A's messages and tokens, none of org B's", async () => {
    // The same select the usage data layer pages through.
    const { data, error } = await asUser(seed.adminA, seed.orgA.clerk_org_id, shape)
      .from('chat_messages')
      .select('role, provider, input_tokens, output_tokens, created_at')
    expect(error).toBeNull()
    // 1 user + 2 assistant rows, all org A's. Were even one org B row
    // visible, the counts and every token sum below would be wrong.
    expect(data).toHaveLength(3)
    const inputSum = data!.reduce((s, r) => s + (r.input_tokens ?? 0), 0)
    const outputSum = data!.reduce((s, r) => s + (r.output_tokens ?? 0), 0)
    expect(inputSum).toBe(2 * A_TOKENS.input)
    expect(outputSum).toBe(2 * A_TOKENS.output)
  })

  it("org A's admin sums org A's checks, none of org B's", async () => {
    const { data, error } = await asUser(seed.adminA, seed.orgA.clerk_org_id, shape)
      .from('monitor_daily_rollups')
      .select('day, check_count')
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data![0].check_count).toBe(11)
  })

  it("org A's seat count sees only org A's membership", async () => {
    const { data, error } = await asUser(seed.adminA, seed.orgA.clerk_org_id, shape)
      .from('org_members')
      .select('role')
    expect(error).toBeNull()
    expect(data).toHaveLength(3)
  })

  it("org B's admin sums org B alone, so neither direction leaks", async () => {
    const { data, error } = await asUser(seed.adminB, seed.orgB.clerk_org_id, shape)
      .from('chat_messages')
      .select('input_tokens')
    expect(error).toBeNull()
    // 1 user + 4 assistant rows, none of org A's.
    expect(data).toHaveLength(5)
    const inputSum = data!.reduce((s, r) => s + (r.input_tokens ?? 0), 0)
    expect(inputSum).toBe(4 * B_TOKENS.input)
  })

  it('a member sees only their own conversations, which is why the screen needs the admin read', async () => {
    // memberA created org A's one conversation and sees its rows; memberA2
    // created nothing and sees none. The admin only screen exists so the
    // whole org view comes from the admin visibility rule, proven above.
    const { data: own } = await asUser(seed.memberA, seed.orgA.clerk_org_id, shape)
      .from('chat_messages')
      .select('role')
    expect(own).toHaveLength(3)
    const { data: none } = await asUser(seed.memberA2, seed.orgA.clerk_org_id, shape)
      .from('chat_messages')
      .select('role')
    expect(none).toEqual([])
  })
})

describe.each(CLAIM_SHAPES)('organizations.timezone write path (%s claim shape)', (shape) => {
  it('an org admin stores and rereads their own zone', async () => {
    const asAdminA = asUser(seed.adminA, seed.orgA.clerk_org_id, shape)
    const { error } = await asAdminA
      .from('organizations')
      .update({ timezone: 'America/New_York' })
      .eq('id', orgAId)
    expect(error).toBeNull()
    const { data } = await asAdminA
      .from('organizations')
      .select('timezone')
      .eq('id', orgAId)
      .single()
    expect(data!.timezone).toBe('America/New_York')
  })

  it("a member's update matches zero rows", async () => {
    await service.from('organizations').update({ timezone: 'Asia/Tokyo' }).eq('id', orgAId)
    await asUser(seed.memberA, seed.orgA.clerk_org_id, shape)
      .from('organizations')
      .update({ timezone: 'Europe/Paris' })
      .eq('id', orgAId)
    const { data } = await service
      .from('organizations')
      .select('timezone')
      .eq('id', orgAId)
      .single()
    expect(data!.timezone).toBe('Asia/Tokyo')
  })

  it("org B's admin cannot set org A's zone", async () => {
    await asUser(seed.adminB, seed.orgB.clerk_org_id, shape)
      .from('organizations')
      .update({ timezone: 'Europe/London' })
      .eq('id', orgAId)
    const { data } = await service
      .from('organizations')
      .select('timezone')
      .eq('id', orgAId)
      .single()
    expect(data!.timezone).toBe('Asia/Tokyo')
  })

  it('the update grant reaches timezone alone: renaming the org is refused at the verb', async () => {
    const { error } = await asUser(seed.adminA, seed.orgA.clerk_org_id, shape)
      .from('organizations')
      .update({ name: 'Hijacked Name' })
      .eq('id', orgAId)
    expect(error).not.toBeNull()
    const { data } = await service
      .from('organizations')
      .select('name')
      .eq('id', orgAId)
      .single()
    expect(data!.name).toBe(seed.orgA.name)
  })
})

describe('the timezone format constraint', () => {
  it('refuses a value that is not shaped like an IANA zone, even from the service role', async () => {
    const { error } = await service
      .from('organizations')
      .update({ timezone: 'not a zone' })
      .eq('id', orgBId)
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/organizations_timezone_format/)
  })

  it('accepts Area/Location shapes and UTC', async () => {
    for (const zone of ['America/Argentina/Buenos_Aires', 'UTC']) {
      const { error } = await service
        .from('organizations')
        .update({ timezone: zone })
        .eq('id', orgBId)
      expect(error).toBeNull()
    }
  })
})
