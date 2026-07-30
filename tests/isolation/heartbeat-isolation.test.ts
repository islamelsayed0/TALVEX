import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  CLAIM_SHAPES,
  createAnonClient,
  createMemberClient,
  createServiceClient,
  memberToken,
  preflight,
  type TestClient,
} from './local-stack'

// The sweep heartbeat (migration 018).
//
// This table is the one exception in the schema: its select policy is
// `using (true)` for both authenticated and anon, so unlike every other suite
// in this directory the interesting assertion is NOT that org B is invisible.
// It is that the table is deliberately shared, and that being shared costs
// nothing because there is nothing tenant shaped in it to leak.
//
// What this file actually guards is the write boundary and the anon column
// grant. A writable heartbeat would let any admin fake liveness (stamping it
// forward so a dead sweep looks healthy) or fake an outage (clearing it), and
// the whole value of the table is that the number came from the sweep itself.
// So every user write verb must be refused at the grant, before RLS is even
// consulted, and the refusal must be an error rather than a silent zero rows.
//
// CLAUDE.md rule 8: like every file in this directory, this suite must never
// be skipped, weakened, or deleted.

const runId = randomUUID()

const seed = {
  orgA: { clerk_org_id: `org_hbtest_a_${runId}`, name: 'Heartbeat Test Org A' },
  orgB: { clerk_org_id: `org_hbtest_b_${runId}`, name: 'Heartbeat Test Org B' },
  adminA: `user_hbtest_admin_a_${runId}`,
  memberB: `user_hbtest_member_b_${runId}`,
}

let service: TestClient
let orgAId: string
let orgBId: string
let seeded = false

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
    { org_id: orgBId, clerk_user_id: seed.memberB, role: 'member' },
  ])
  if (memberErr) throw new Error(`Seeding org_members failed: ${memberErr.message}`)
  seeded = true
}, 60_000)

afterAll(async () => {
  if (!seeded) return
  await service
    .from('organizations')
    .delete()
    .in('clerk_org_id', [seed.orgA.clerk_org_id, seed.orgB.clerk_org_id])
})

describe.each(CLAIM_SHAPES)('claim shape: %s', (shape) => {
  const asAdminA = () =>
    createMemberClient(
      memberToken({
        clerkUserId: seed.adminA,
        clerkOrgId: seed.orgA.clerk_org_id,
        shape,
        claimRole: 'admin',
      }),
    )
  const asMemberB = () =>
    createMemberClient(
      memberToken({
        clerkUserId: seed.memberB,
        clerkOrgId: seed.orgB.clerk_org_id,
        shape,
        claimRole: 'member',
      }),
    )

  it('an admin reads the heartbeat row', async () => {
    const { data, error } = await asAdminA()
      .from('platform_heartbeat')
      .select('id, last_run_at, run_count')
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data![0].id).toBe('sweep')
  })

  // INTENDED, not a leak. A reviewer seeing a cross org read succeed in this
  // directory should stop and check, so it is spelled out: the row says the
  // platform's sweep ran. It names no organization, counts nothing belonging
  // to anyone, and is the same single row for every tenant. If a column is
  // ever added here that identifies an org, this assertion becomes wrong and
  // the column belongs in an org scoped table instead.
  it('a member of a different org reads the same row, deliberately', async () => {
    const { data, error } = await asMemberB().from('platform_heartbeat').select('id')
    expect(error).toBeNull()
    expect(data).toEqual([{ id: 'sweep' }])
  })

  it('an admin cannot update the heartbeat, refused at the grant', async () => {
    const { error } = await asAdminA()
      .from('platform_heartbeat')
      .update({ last_run_at: new Date().toISOString() })
      .eq('id', 'sweep')
    expect(error).not.toBeNull()
    expect(`${error?.code} ${error?.message}`).toMatch(/42501|permission denied/i)
  })

  it('an admin cannot insert a second heartbeat row', async () => {
    const { error } = await asAdminA()
      .from('platform_heartbeat')
      .insert({ id: 'sweep', last_run_at: new Date().toISOString() })
    expect(error).not.toBeNull()
    expect(`${error?.code} ${error?.message}`).toMatch(/42501|permission denied/i)
  })

  it('an admin cannot delete the heartbeat row', async () => {
    const { error } = await asAdminA().from('platform_heartbeat').delete().eq('id', 'sweep')
    expect(error).not.toBeNull()
    expect(`${error?.code} ${error?.message}`).toMatch(/42501|permission denied/i)

    // Proven, not assumed: the row is still there.
    const { data } = await service.from('platform_heartbeat').select('id')
    expect(data).toHaveLength(1)
  })

  it('a member cannot write it either', async () => {
    const { error } = await asMemberB()
      .from('platform_heartbeat')
      .update({ step_failures: 99 })
      .eq('id', 'sweep')
    expect(error).not.toBeNull()
    expect(`${error?.code} ${error?.message}`).toMatch(/42501|permission denied/i)
  })
})

describe('anon sees freshness and nothing else', () => {
  // The public endpoint the external watcher polls runs as anon. The column
  // grant, not the route, is what keeps operational counts out of that
  // response, so it is asserted here rather than trusted to the handler.
  it('reads the freshness columns', async () => {
    const { data, error } = await createAnonClient()
      .from('platform_heartbeat')
      .select('id, last_run_at, last_success_at')
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })

  it('is refused run_count', async () => {
    const { error } = await createAnonClient().from('platform_heartbeat').select('run_count')
    expect(error).not.toBeNull()
    expect(`${error?.code} ${error?.message}`).toMatch(/42501|permission denied/i)
  })

  it('is refused step_failures and duration_ms', async () => {
    for (const column of ['step_failures', 'duration_ms']) {
      const { error } = await createAnonClient().from('platform_heartbeat').select(column)
      expect(error, `anon should not read ${column}`).not.toBeNull()
    }
  })

  it('cannot write the heartbeat', async () => {
    const { error } = await createAnonClient()
      .from('platform_heartbeat')
      .update({ last_run_at: new Date().toISOString() })
      .eq('id', 'sweep')
    expect(error).not.toBeNull()
  })
})

describe('the service role stamp path, which is the only writer', () => {
  it('updates the row and the trigger increments run_count', async () => {
    const before = await service
      .from('platform_heartbeat')
      .select('run_count')
      .eq('id', 'sweep')
      .single()

    const stampedAt = new Date().toISOString()
    const { error } = await service
      .from('platform_heartbeat')
      .update({ last_run_at: stampedAt, last_success_at: stampedAt, step_failures: 0 })
      .eq('id', 'sweep')
    expect(error).toBeNull()

    const after = await service
      .from('platform_heartbeat')
      .select('last_run_at, run_count')
      .eq('id', 'sweep')
      .single()
    // Compared as instants: Postgres renders the offset as +00:00 where
    // toISOString renders Z, and that difference is serialization, not time.
    expect(Date.parse(after.data!.last_run_at!)).toBe(Date.parse(stampedAt))
    // The count is maintained by the trigger, so the sweep never reads before
    // it writes and two overlapping sweeps cannot lose an increment.
    expect(after.data!.run_count).toBe(before.data!.run_count + 1)
  })

  it('cannot create a second row even as the service role', async () => {
    const { error } = await service
      .from('platform_heartbeat')
      .insert({ id: 'other' })
    expect(error).not.toBeNull()
    // The single row shape is a check constraint, not a convention.
    expect(`${error?.code} ${error?.message}`).toMatch(/23514|check constraint/i)
  })
})
