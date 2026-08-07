import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { managedAnswersUsed } from '@/lib/billing/managed-ai'
import { checkOrgAccess } from '@/lib/billing/org-access'
import type { Database } from '@/lib/db/types'
import {
  CLAIM_SHAPES,
  createMemberClient,
  createServiceClient,
  memberToken,
  preflight,
  type TestClient,
} from './local-stack'

// Isolation proofs for F13 PR 3 enforcement. Extends the suite per CLAUDE.md
// rules 2 and 8. Under test:
//
//   - THE METER COUNTS EXACTLY PLATFORM ANSWERS IN THE CURRENT MONTH: byok
//     rows, user rows, pre F13 rows (NULL key_source), and last month's
//     platform rows all stay out of the count.
//   - THE METER'S INPUTS CANNOT BE WRITTEN BY USERS: no session holds any
//     write verb on chat_messages, so key_source can be neither planted nor
//     flipped nor deleted by a tenant, in either claim shape. (The refusal
//     is the migration 008 grant posture; asserted here against the meter's
//     own column because the meter is what makes it money relevant now.)
//   - THE SHAPE DISCIPLINE HOLDS AT THE CONSTRAINT: even the service role
//     cannot write a user row carrying a key_source.
//   - THE ORG ALLOWANCE is per person, oldest memberships first, raised for
//     everyone who belongs to a Business org, and always allows the single
//     org case.

const runId = randomUUID()
const seed = {
  orgA: { clerk_org_id: `org_managed_a_${runId}`, name: 'Managed Test Org A' },
  orgB: { clerk_org_id: `org_managed_b_${runId}`, name: 'Managed Test Org B' },
  admin: `user_managed_admin_${runId}`,
  member: `user_managed_member_${runId}`,
  soloMember: `user_managed_solo_${runId}`,
}

let service: TestClient
let orgAId: string
let orgBId: string
let conversationId: string
let seeded = false

const NOW = Date.parse('2026-08-15T12:00:00Z')
const THIS_MONTH = '2026-08-10T09:00:00Z'
const LAST_MONTH = '2026-07-10T09:00:00Z'

beforeAll(async () => {
  await preflight()
  service = createServiceClient()

  const { data: orgs, error: orgErr } = await service
    .from('organizations')
    .insert([
      { ...seed.orgA, timezone: 'UTC' },
      { ...seed.orgB, timezone: 'UTC' },
    ])
    .select()
  if (orgErr || orgs.length !== 2) {
    throw new Error(`Seeding organizations failed: ${orgErr?.message}`)
  }
  orgAId = orgs.find((o) => o.clerk_org_id === seed.orgA.clerk_org_id)!.id
  orgBId = orgs.find((o) => o.clerk_org_id === seed.orgB.clerk_org_id)!.id

  // Membership ORDER matters for the allowance test: the admin joined A
  // first, B second. The solo member belongs to B alone.
  const { error: mErr1 } = await service.from('org_members').insert([
    { org_id: orgAId, clerk_user_id: seed.admin, role: 'admin' },
    { org_id: orgAId, clerk_user_id: seed.member, role: 'member' },
  ])
  if (mErr1) throw new Error(`Seeding members failed: ${mErr1.message}`)
  const later = new Date(Date.now() + 1000).toISOString()
  const { error: mErr2 } = await service.from('org_members').insert([
    { org_id: orgBId, clerk_user_id: seed.admin, role: 'admin', created_at: later },
    { org_id: orgBId, clerk_user_id: seed.soloMember, role: 'member', created_at: later },
  ])
  if (mErr2) throw new Error(`Seeding members failed: ${mErr2.message}`)

  const { data: convo, error: cErr } = await service
    .from('chat_conversations')
    .insert({ org_id: orgAId, created_by: seed.member, title: 'Meter test' })
    .select('id')
    .single()
  if (cErr) throw new Error(`Seeding conversation failed: ${cErr.message}`)
  conversationId = convo.id

  // The transcript the meter reads: 2 platform answers this month, and one
  // each of every shape that must NOT count.
  type MessageInsert = Database['public']['Tables']['chat_messages']['Insert']
  const msg = (
    over: Omit<MessageInsert, 'org_id' | 'conversation_id'>,
  ): MessageInsert => ({
    org_id: orgAId,
    conversation_id: conversationId,
    ...over,
  })
  const { error: msgErr } = await service.from('chat_messages').insert([
    msg({ role: 'user', content: 'q1', created_at: THIS_MONTH }),
    msg({
      role: 'assistant',
      content: 'platform answer 1',
      provider: 'anthropic',
      model: 'claude',
      key_source: 'platform',
      created_at: THIS_MONTH,
    }),
    msg({
      role: 'assistant',
      content: 'platform answer 2',
      provider: 'anthropic',
      model: 'claude',
      key_source: 'platform',
      created_at: '2026-08-14T09:00:00Z',
    }),
    msg({
      role: 'assistant',
      content: 'byok answer, never metered',
      provider: 'openai',
      model: 'gpt',
      key_source: 'byok',
      created_at: THIS_MONTH,
    }),
    msg({
      role: 'assistant',
      content: 'pre F13 answer, NULL source',
      provider: 'anthropic',
      model: 'claude',
      created_at: THIS_MONTH,
    }),
    msg({
      role: 'assistant',
      content: 'platform answer, last month',
      provider: 'anthropic',
      model: 'claude',
      key_source: 'platform',
      created_at: LAST_MONTH,
    }),
  ])
  if (msgErr) throw new Error(`Seeding messages failed: ${msgErr.message}`)

  seeded = true
}, 60_000)

afterAll(async () => {
  if (!seeded) return
  await service
    .from('organizations')
    .delete()
    .in('clerk_org_id', [seed.orgA.clerk_org_id, seed.orgB.clerk_org_id])
})

describe('the meter counts exactly platform answers in the org month', () => {
  it('counts 2: not byok, not user, not pre F13 NULL, not last month', async () => {
    expect(await managedAnswersUsed(service, orgAId, 'UTC', NOW)).toBe(2)
  })

  it('counts an empty org as zero, never an error', async () => {
    expect(await managedAnswersUsed(service, orgBId, 'UTC', NOW)).toBe(0)
  })
})

describe.each(CLAIM_SHAPES)('the meter cannot be written by users (%s claim shape)', (shape) => {
  const asAdmin = () =>
    createMemberClient(
      memberToken({ clerkUserId: seed.admin, clerkOrgId: seed.orgA.clerk_org_id, shape }),
    )

  it('an admin cannot plant a platform row to burn the allowance', async () => {
    const { error } = await asAdmin().from('chat_messages').insert({
      org_id: orgAId,
      conversation_id: conversationId,
      role: 'assistant',
      content: 'forged',
      provider: 'anthropic',
      model: 'claude',
      key_source: 'platform',
    })
    expect(error).not.toBeNull()
    expect(error!.code).toBe('42501')
  })

  it('an admin cannot flip byok rows to platform or platform to byok', async () => {
    await asAdmin()
      .from('chat_messages')
      .update({ key_source: 'byok' })
      .eq('org_id', orgAId)
    expect(await managedAnswersUsed(service, orgAId, 'UTC', NOW)).toBe(2)
  })

  it('an admin cannot delete answers to refill the allowance', async () => {
    await asAdmin().from('chat_messages').delete().eq('org_id', orgAId)
    expect(await managedAnswersUsed(service, orgAId, 'UTC', NOW)).toBe(2)
  })
})

describe('the shape discipline holds at the constraint', () => {
  it('even the service role cannot write a user row carrying a key_source', async () => {
    const { error } = await service.from('chat_messages').insert({
      org_id: orgAId,
      conversation_id: conversationId,
      role: 'user',
      content: 'user row with a key source',
      key_source: 'platform',
    })
    expect(error).not.toBeNull()
  })
})

describe('the org allowance (checkOrgAccess)', () => {
  it('a single org member is always allowed, whatever the plan', async () => {
    expect(
      await checkOrgAccess(seed.soloMember, seed.orgB.clerk_org_id, service),
    ).toEqual({ allowed: true })
  })

  it('a two org user on free plans: oldest membership in, newest out', async () => {
    expect(
      await checkOrgAccess(seed.admin, seed.orgA.clerk_org_id, service),
    ).toEqual({ allowed: true })
    expect(
      await checkOrgAccess(seed.admin, seed.orgB.clerk_org_id, service),
    ).toEqual({ allowed: false, allowance: 1, position: 2, total: 2 })
  })

  it('a Business plan anywhere in the set raises the allowance for its members', async () => {
    const { error } = await service.from('org_billing').insert({
      org_id: orgAId,
      plan: 'business',
      status: 'active',
      ai_answers_included: 300,
      org_limit: 10,
      monitor_limit: null,
    })
    expect(error).toBeNull()

    expect(
      await checkOrgAccess(seed.admin, seed.orgB.clerk_org_id, service),
    ).toEqual({ allowed: true })

    // A canceled Business drops the allowance back to one.
    await service
      .from('org_billing')
      .update({ status: 'canceled', plan: 'free', org_limit: 1 })
      .eq('org_id', orgAId)
    expect(
      await checkOrgAccess(seed.admin, seed.orgB.clerk_org_id, service),
    ).toMatchObject({ allowed: false, allowance: 1 })
  })
})
