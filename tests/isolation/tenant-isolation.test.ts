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

// THE isolation proof (docs/PHASE_0_PLAN.md Task 5). Two organizations, one
// member each; as A's member, B's rows must never come back. Empty, not
// error: RLS filters rows, it does not reject queries, so a cross tenant
// probe is indistinguishable from a row that does not exist.
//
// CLAUDE.md rule 8: this suite must never be skipped, weakened, or deleted.
// When its preconditions are missing it fails loudly (see preflight) instead
// of skipping. Every future tenant table adds its own cases here.

const runId = randomUUID()

// Ids are unique per run so a long lived local stack never collides with a
// previous run's leftovers, and shaped like real Clerk ids for legibility.
const seed = {
  orgA: { clerk_org_id: `org_isotest_a_${runId}`, name: 'Isolation Test Org A' },
  orgB: { clerk_org_id: `org_isotest_b_${runId}`, name: 'Isolation Test Org B' },
  userA: `user_isotest_a_${runId}`,
  userB: `user_isotest_b_${runId}`,
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
    { org_id: orgAId, clerk_user_id: seed.userA, role: 'member' },
    { org_id: orgBId, clerk_user_id: seed.userB, role: 'member' },
  ])
  if (memberErr) {
    throw new Error(`Seeding org_members failed: ${memberErr.message}`)
  }
  seeded = true
}, 60_000)

afterAll(async () => {
  // Nothing to clean when preflight or seeding threw; returning here keeps
  // the real failure as the only error on screen.
  if (!seeded) return
  // FK cascade removes the membership rows with their organizations.
  await service
    .from('organizations')
    .delete()
    .in('clerk_org_id', [seed.orgA.clerk_org_id, seed.orgB.clerk_org_id])
})

describe('control: the seed itself is visible without RLS', () => {
  // Guards the suite's own validity. If seeding silently failed, every
  // "B is invisible" assertion below would pass against an empty database
  // and prove nothing. This makes that false pass impossible.
  it('service role sees both organizations and both members', async () => {
    const { data: orgs, error } = await service
      .from('organizations')
      .select('id')
      .in('id', [orgAId, orgBId])
    expect(error).toBeNull()
    expect(orgs).toHaveLength(2)

    const { data: members } = await service
      .from('org_members')
      .select('clerk_user_id')
      .in('org_id', [orgAId, orgBId])
    expect(members?.map((m) => m.clerk_user_id).sort()).toEqual(
      [seed.userA, seed.userB].sort(),
    )
  })
})

// Both Clerk claim shapes, separately: the legacy top level org_id and the
// v2 nested o.id (docs/DECISIONS.md). The coalesce in clerk_active_org_id()
// must isolate correctly under each; a token only ever carries one shape.
describe.each(CLAIM_SHAPES)("as org A's member (%s claim shape)", (shape) => {
  const asMemberA = () =>
    createMemberClient(
      memberToken({
        clerkUserId: seed.userA,
        clerkOrgId: seed.orgA.clerk_org_id,
        shape,
      }),
    )

  it('listing organizations returns org A and never org B', async () => {
    const { data, error } = await asMemberA().from('organizations').select()
    expect(error).toBeNull()
    const ids = (data ?? []).map((o) => o.id)
    expect(ids).toContain(orgAId)
    expect(ids).not.toContain(orgBId)
  })

  it("listing org_members returns A's membership and never B's", async () => {
    const { data, error } = await asMemberA().from('org_members').select()
    expect(error).toBeNull()
    const users = (data ?? []).map((m) => m.clerk_user_id)
    expect(users).toContain(seed.userA)
    expect(users).not.toContain(seed.userB)
    expect((data ?? []).map((m) => m.org_id)).not.toContain(orgBId)
  })

  it("direct select of org B by primary key returns empty, not an error", async () => {
    const { data, error } = await asMemberA()
      .from('organizations')
      .select()
      .eq('id', orgBId)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('direct select of org B by clerk_org_id returns empty, not an error', async () => {
    const { data, error } = await asMemberA()
      .from('organizations')
      .select()
      .eq('clerk_org_id', seed.orgB.clerk_org_id)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('maybeSingle() on org B resolves to null, not an error', async () => {
    const { data, error } = await asMemberA()
      .from('organizations')
      .select()
      .eq('id', orgBId)
      .maybeSingle()
    expect(error).toBeNull()
    expect(data).toBeNull()
  })

  it("direct select of B's membership rows returns empty, not an error", async () => {
    const { data, error } = await asMemberA()
      .from('org_members')
      .select()
      .eq('org_id', orgBId)
    expect(error).toBeNull()
    expect(data).toEqual([])

    const byUser = await asMemberA()
      .from('org_members')
      .select()
      .eq('clerk_user_id', seed.userB)
    expect(byUser.error).toBeNull()
    expect(byUser.data).toEqual([])
  })
})

describe('a session with no active organization', () => {
  // The hidePersonal failure mode from docs/DECISIONS.md: no org claim means
  // the RLS predicate resolves to null and matches nothing. Deliberate small
  // addition beyond the Task 5 letter; it pins down that this reads as an
  // empty tenant (zero rows), never as an error or as someone else's data.
  it('sees zero rows in both tables, without error', async () => {
    const orgless = createMemberClient(orglessToken(seed.userA))

    const orgs = await orgless.from('organizations').select()
    expect(orgs.error).toBeNull()
    expect(orgs.data).toEqual([])

    const members = await orgless.from('org_members').select()
    expect(members.error).toBeNull()
    expect(members.data).toEqual([])
  })
})
