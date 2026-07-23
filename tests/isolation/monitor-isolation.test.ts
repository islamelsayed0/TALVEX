import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  CLAIM_SHAPES,
  createMemberClient,
  createServiceClient,
  memberToken,
  orglessToken,
  preflight,
  type TestClient,
} from './local-stack'

// Isolation proof for the monitors feature (Phase 1 Task 1), extending the
// Task 5 suite: every tenant table gets its cases here (CLAUDE.md rules 2
// and 8; never skip, weaken, or delete).
//
// Monitors are the FIRST feature where user sessions WRITE tenant rows, so
// this file proves write isolation explicitly rather than assuming it:
// the with check policies must stop a member inserting, updating, or
// deleting rows carrying another org's org_id. Reads follow the Task 5
// pattern: cross tenant probes return empty, never error, because RLS
// filters rows rather than rejecting queries.
//
// monitor_checks and monitor_daily_rollups are written only by the cron
// sweep on the service role; a user session must not be able to write them
// AT ALL, not even for its own org. That is asserted here too.

const runId = randomUUID()

const seed = {
  orgA: { clerk_org_id: `org_montest_a_${runId}`, name: 'Monitor Test Org A' },
  orgB: { clerk_org_id: `org_montest_b_${runId}`, name: 'Monitor Test Org B' },
  userA: `user_montest_a_${runId}`,
  userB: `user_montest_b_${runId}`,
}

let service: TestClient
let orgAId: string
let orgBId: string
let monitorA1Id: string
let monitorA2Id: string
let monitorBId: string
let seeded = false

const asMemberA = (shape: (typeof CLAIM_SHAPES)[number] = 'legacy') =>
  createMemberClient(
    memberToken({
      clerkUserId: seed.userA,
      clerkOrgId: seed.orgA.clerk_org_id,
      shape,
    }),
  )

const asMemberB = (shape: (typeof CLAIM_SHAPES)[number]) =>
  createMemberClient(
    memberToken({
      clerkUserId: seed.userB,
      clerkOrgId: seed.orgB.clerk_org_id,
      shape,
    }),
  )

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
    { org_id: orgAId, clerk_user_id: seed.userA, role: 'member' },
    { org_id: orgBId, clerk_user_id: seed.userB, role: 'member' },
  ])
  if (memberErr) {
    throw new Error(`Seeding org_members failed: ${memberErr.message}`)
  }

  // The monitors are created THROUGH MEMBER SESSIONS, one under each claim
  // shape, so the seeding itself proves the legitimate write path works
  // under RLS. Service role seeding here would prove nothing about users.
  const a1 = await asMemberA('legacy')
    .from('monitors')
    .insert({ org_id: orgAId, name: 'A one', url: 'https://a-one.example.com' })
    .select()
    .single()
  const a2 = await asMemberA('v2')
    .from('monitors')
    .insert({ org_id: orgAId, name: 'A two', url: 'https://a-two.example.com' })
    .select()
    .single()
  const b1 = await asMemberB('v2')
    .from('monitors')
    .insert({ org_id: orgBId, name: 'B one', url: 'https://b-one.example.com' })
    .select()
    .single()
  if (a1.error || a2.error || b1.error) {
    throw new Error(
      `Member monitor creation failed: ${
        a1.error?.message ?? a2.error?.message ?? b1.error?.message
      }`,
    )
  }
  monitorA1Id = a1.data.id
  monitorA2Id = a2.data.id
  monitorBId = b1.data.id

  // Check history and rollups are cron territory (service role), so the
  // service client seeds them, mirroring production's write path.
  const { error: checksErr } = await service.from('monitor_checks').insert([
    { monitor_id: monitorA1Id, org_id: orgAId, status: 'up', response_time_ms: 120 },
    { monitor_id: monitorA1Id, org_id: orgAId, status: 'down', error_message: 'HTTP 503' },
    { monitor_id: monitorBId, org_id: orgBId, status: 'up', response_time_ms: 80 },
  ])
  if (checksErr) throw new Error(`Seeding checks failed: ${checksErr.message}`)

  const today = new Date().toISOString().slice(0, 10)
  const { error: rollupErr } = await service.from('monitor_daily_rollups').insert([
    {
      monitor_id: monitorA1Id,
      org_id: orgAId,
      day: today,
      uptime_percent: 50,
      avg_response_ms: 120,
      min_response_ms: 120,
      max_response_ms: 120,
      check_count: 2,
    },
    {
      monitor_id: monitorBId,
      org_id: orgBId,
      day: today,
      uptime_percent: 100,
      avg_response_ms: 80,
      min_response_ms: 80,
      max_response_ms: 80,
      check_count: 1,
    },
  ])
  if (rollupErr) throw new Error(`Seeding rollups failed: ${rollupErr.message}`)

  seeded = true
}, 60_000)

afterAll(async () => {
  if (!seeded) return
  // FK cascades remove monitors, checks, and rollups with the organizations.
  await service
    .from('organizations')
    .delete()
    .in('clerk_org_id', [seed.orgA.clerk_org_id, seed.orgB.clerk_org_id])
})

describe('control: the seed is visible without RLS', () => {
  // Guards the suite's validity: if seeding silently failed, every "B sees
  // nothing" assertion below would pass vacuously against empty tables.
  it('service role sees all three monitors, all checks, both rollups', async () => {
    const monitors = await service
      .from('monitors')
      .select('id')
      .in('id', [monitorA1Id, monitorA2Id, monitorBId])
    expect(monitors.error).toBeNull()
    expect(monitors.data).toHaveLength(3)

    const checks = await service
      .from('monitor_checks')
      .select('id')
      .in('monitor_id', [monitorA1Id, monitorBId])
    expect(checks.error).toBeNull()
    expect(checks.data).toHaveLength(3)

    const rollups = await service
      .from('monitor_daily_rollups')
      .select('monitor_id')
      .in('org_id', [orgAId, orgBId])
    expect(rollups.error).toBeNull()
    expect(rollups.data).toHaveLength(2)
  })
})

describe.each(CLAIM_SHAPES)(
  "read isolation as org B's member (%s claim shape)",
  (shape) => {
    it("listing monitors returns B's and never A's", async () => {
      const { data, error } = await asMemberB(shape).from('monitors').select()
      expect(error).toBeNull()
      const ids = (data ?? []).map((m) => m.id)
      expect(ids).toContain(monitorBId)
      expect(ids).not.toContain(monitorA1Id)
      expect(ids).not.toContain(monitorA2Id)
    })

    it("direct select of A's monitor by id returns empty, not an error", async () => {
      const { data, error } = await asMemberB(shape)
        .from('monitors')
        .select()
        .eq('id', monitorA1Id)
      expect(error).toBeNull()
      expect(data).toEqual([])
    })

    it("A's check history is invisible, by monitor id and by org id", async () => {
      const byMonitor = await asMemberB(shape)
        .from('monitor_checks')
        .select()
        .eq('monitor_id', monitorA1Id)
      expect(byMonitor.error).toBeNull()
      expect(byMonitor.data).toEqual([])

      const byOrg = await asMemberB(shape)
        .from('monitor_checks')
        .select()
        .eq('org_id', orgAId)
      expect(byOrg.error).toBeNull()
      expect(byOrg.data).toEqual([])

      // And the unfiltered list carries only B's rows.
      const all = await asMemberB(shape).from('monitor_checks').select()
      expect(all.error).toBeNull()
      expect((all.data ?? []).map((c) => c.org_id)).toEqual([orgBId])
    })

    it("A's rollups are invisible", async () => {
      const { data, error } = await asMemberB(shape)
        .from('monitor_daily_rollups')
        .select()
      expect(error).toBeNull()
      expect((data ?? []).map((r) => r.org_id)).toEqual([orgBId])
    })
  },
)

describe.each(CLAIM_SHAPES)(
  "write isolation as org B's member (%s claim shape)",
  (shape) => {
    it("cannot insert a monitor carrying A's org_id (with check)", async () => {
      const { data, error } = await asMemberB(shape)
        .from('monitors')
        .insert({
          org_id: orgAId,
          name: 'smuggled into A',
          url: 'https://evil.example.com',
        })
        .select()
      expect(error).not.toBeNull()
      expect(data).toBeNull()

      // Nothing landed, confirmed without RLS in the way.
      const { data: planted } = await service
        .from('monitors')
        .select('id')
        .eq('org_id', orgAId)
        .eq('name', 'smuggled into A')
      expect(planted).toEqual([])
    })

    it("cannot update A's monitor, and cannot move it into org B", async () => {
      const rename = await asMemberB(shape)
        .from('monitors')
        .update({ name: 'defaced' })
        .eq('id', monitorA1Id)
        .select()
      expect(rename.error).toBeNull() // filtered, not rejected: zero rows matched
      expect(rename.data).toEqual([])

      const steal = await asMemberB(shape)
        .from('monitors')
        .update({ org_id: orgBId })
        .eq('id', monitorA1Id)
        .select()
      expect(steal.data ?? []).toEqual([])

      const { data: intact } = await service
        .from('monitors')
        .select('name, org_id')
        .eq('id', monitorA1Id)
        .single()
      expect(intact).toEqual({ name: 'A one', org_id: orgAId })
    })

    it("cannot delete A's monitor", async () => {
      const { data, error } = await asMemberB(shape)
        .from('monitors')
        .delete()
        .eq('id', monitorA1Id)
        .select()
      expect(error).toBeNull()
      expect(data).toEqual([])

      const { data: survives } = await service
        .from('monitors')
        .select('id')
        .eq('id', monitorA1Id)
      expect(survives).toHaveLength(1)
    })

    it('cannot write check history at all, not even for org B itself', async () => {
      // The cron sweep (service role) is the only writer of checks and
      // rollups; user sessions have neither policies nor grants for it.
      const check = await asMemberB(shape).from('monitor_checks').insert({
        monitor_id: monitorBId,
        org_id: orgBId,
        status: 'up',
        response_time_ms: 1,
      })
      expect(check.error).not.toBeNull()

      const rollup = await asMemberB(shape).from('monitor_daily_rollups').insert({
        monitor_id: monitorBId,
        org_id: orgBId,
        day: '2001-01-01',
        uptime_percent: 100,
        check_count: 1,
      })
      expect(rollup.error).not.toBeNull()

      const fake = await asMemberB(shape)
        .from('monitor_daily_rollups')
        .select()
        .eq('day', '2001-01-01')
      expect(fake.data).toEqual([])
    })
  },
)

describe('a session with no active organization', () => {
  it('sees zero rows in all three monitor tables, without error', async () => {
    const orgless = createMemberClient(orglessToken(seed.userA))

    for (const table of [
      'monitors',
      'monitor_checks',
      'monitor_daily_rollups',
    ] as const) {
      const { data, error } = await orgless.from(table).select()
      expect(error, `${table} select should not error`).toBeNull()
      expect(data, `${table} must be empty for an org-less session`).toEqual([])
    }
  })

  it('cannot create a monitor anywhere', async () => {
    const orgless = createMemberClient(orglessToken(seed.userA))
    const { error } = await orgless.from('monitors').insert({
      org_id: orgAId,
      name: 'orgless write',
      url: 'https://nowhere.example.com',
    })
    expect(error).not.toBeNull()

    const { data: planted } = await service
      .from('monitors')
      .select('id')
      .eq('name', 'orgless write')
    expect(planted).toEqual([])
  })
})
