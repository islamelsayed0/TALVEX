import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  createAnonClient,
  createMemberClient,
  createServiceClient,
  memberToken,
  preflight,
  type TestClient,
} from './local-stack'

// Verb level proof for the tenancy spine (migration 009).
//
// tenant-isolation.test.ts proves the ROW filter: as org A, org B's rows never
// come back. This file proves the layer underneath it, which `organizations`
// and `org_members` did not have until migration 009 backfilled it. Before
// that migration both tables carried ALL privileges for anon AND authenticated,
// inherited from Supabase's auto exposure of new public tables, and only RLS
// stood between an anonymous caller and a write. Auto exposure is deprecated
// upstream (removal 2026-10-30) and is now gone from supabase/config.toml, so
// these grants are the only thing holding the line. That makes them worth
// asserting: a future migration that recreates either table without its GRANTs
// fails here rather than in production.
//
// CLAUDE.md rule 8: like every file in this directory, this suite must never
// be skipped, weakened, or deleted.

const runId = randomUUID()

const seed = {
  orgA: { clerk_org_id: `org_granttest_a_${runId}`, name: 'Grant Test Org A' },
  orgB: { clerk_org_id: `org_granttest_b_${runId}`, name: 'Grant Test Org B' },
  adminA: `user_granttest_admin_${runId}`,
  // A throwaway membership the mutation cases below rewrite, so no assertion
  // in this file depends on a row another assertion changed.
  targetA: `user_granttest_target_${runId}`,
  memberB: `user_granttest_b_${runId}`,
}

let service: TestClient
let orgAId: string
let orgBId: string
let seeded = false

// An admin CLAIM, which is what migration 001's org_members write policies
// read. The grants are what this file is about, so the claim is set to the
// most privileged shape a real session can carry: if a write is refused even
// here, it is refused because of the grant, not because of the role.
const asAdminA = () =>
  createMemberClient(
    memberToken({
      clerkUserId: seed.adminA,
      clerkOrgId: seed.orgA.clerk_org_id,
      shape: 'legacy',
      claimRole: 'admin',
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
    { org_id: orgAId, clerk_user_id: seed.adminA, role: 'admin' },
    { org_id: orgAId, clerk_user_id: seed.targetA, role: 'member' },
    { org_id: orgBId, clerk_user_id: seed.memberB, role: 'member' },
  ])
  if (memberErr) {
    throw new Error(`Seeding org_members failed: ${memberErr.message}`)
  }
  seeded = true
}, 60_000)

afterAll(async () => {
  if (!seeded) return
  // FK cascade removes the membership rows with their organizations.
  await service
    .from('organizations')
    .delete()
    .in('clerk_org_id', [seed.orgA.clerk_org_id, seed.orgB.clerk_org_id])
})

describe('anon holds no privilege on the tenancy spine', () => {
  // The strongest statement migration 009 makes. Note what changed: this used
  // to come back as an empty array (auto exposure granted the verb, RLS
  // filtered every row). Now the verb itself is gone, so the database refuses
  // before it ever considers a row.
  it('cannot select organizations at all', async () => {
    const { error } = await createAnonClient().from('organizations').select()
    expect(error).not.toBeNull()
    expect(`${error?.code} ${error?.message}`).toMatch(/42501|permission denied/i)
  })

  it('cannot select org_members at all', async () => {
    const { error } = await createAnonClient().from('org_members').select()
    expect(error).not.toBeNull()
    expect(`${error?.code} ${error?.message}`).toMatch(/42501|permission denied/i)
  })

  it('cannot insert an organization', async () => {
    const { error } = await createAnonClient()
      .from('organizations')
      .insert({ clerk_org_id: `org_granttest_anon_${runId}`, name: 'Should not exist' })
    expect(error).not.toBeNull()

    const { data } = await service
      .from('organizations')
      .select('id')
      .eq('clerk_org_id', `org_granttest_anon_${runId}`)
    expect(data).toEqual([])
  })

  it('cannot insert a membership', async () => {
    const { error } = await createAnonClient()
      .from('org_members')
      .insert({ org_id: orgAId, clerk_user_id: 'user_granttest_intruder', role: 'owner' })
    expect(error).not.toBeNull()

    const { data } = await service
      .from('org_members')
      .select('clerk_user_id')
      .eq('clerk_user_id', 'user_granttest_intruder')
    expect(data).toEqual([])
  })
})

describe('organizations is read only for every signed in session', () => {
  // Migration 001 gave organizations exactly one policy, select. Every write
  // path is the Clerk webhook on the service role. These three cases are the
  // grants saying the same thing, so the absence of a policy is enforced twice.
  it('an org admin cannot insert an organization', async () => {
    const { error } = await asAdminA()
      .from('organizations')
      .insert({ clerk_org_id: `org_granttest_new_${runId}`, name: 'Should not exist' })
    expect(error).not.toBeNull() // no insert grant at all: permission denied
  })

  it('an org admin cannot rename their own organization', async () => {
    const { error } = await asAdminA()
      .from('organizations')
      .update({ name: 'Renamed by a session' })
      .eq('id', orgAId)
    expect(error).not.toBeNull()

    const { data: intact } = await service
      .from('organizations')
      .select('name')
      .eq('id', orgAId)
      .single()
    expect(intact).toEqual({ name: seed.orgA.name })
  })

  it('an org admin cannot delete their own organization', async () => {
    const { error } = await asAdminA().from('organizations').delete().eq('id', orgAId)
    expect(error).not.toBeNull()

    const { data: intact } = await service
      .from('organizations')
      .select('id')
      .eq('id', orgAId)
    expect(intact).toHaveLength(1)
  })
})

describe('org_members: exactly the capability migration 001 intended, no wider', () => {
  it('an org admin may correct a role in their own org', async () => {
    // The capability migration 001 wrote its insert and update policies for.
    // The backfill preserves it deliberately: narrowing grants is not licence
    // to quietly remove a power the schema already granted.
    const { error } = await asAdminA()
      .from('org_members')
      .update({ role: 'technician' })
      .eq('org_id', orgAId)
      .eq('clerk_user_id', seed.targetA)
    expect(error).toBeNull()

    const { data: updated } = await service
      .from('org_members')
      .select('role')
      .eq('org_id', orgAId)
      .eq('clerk_user_id', seed.targetA)
      .single()
    expect(updated).toEqual({ role: 'technician' })
  })

  it('an org admin cannot move a membership to another person', async () => {
    // clerk_user_id is half the primary key: the row's identity. Correcting a
    // role is an update; reassigning whose membership it is would be forgery,
    // and the column grant is what makes that the database's ruling.
    const { error } = await asAdminA()
      .from('org_members')
      .update({ clerk_user_id: 'user_granttest_someone_else' })
      .eq('org_id', orgAId)
      .eq('clerk_user_id', seed.targetA)
    expect(error).not.toBeNull() // permission denied at the column grant

    const { data: intact } = await service
      .from('org_members')
      .select('clerk_user_id')
      .eq('org_id', orgAId)
      .eq('clerk_user_id', seed.targetA)
    expect(intact).toHaveLength(1)
  })

  it('an org admin cannot move a membership into another org', async () => {
    const { error } = await asAdminA()
      .from('org_members')
      .update({ org_id: orgBId })
      .eq('org_id', orgAId)
      .eq('clerk_user_id', seed.targetA)
    expect(error).not.toBeNull() // permission denied at the column grant

    const { data: leaked } = await service
      .from('org_members')
      .select('clerk_user_id')
      .eq('org_id', orgBId)
      .eq('clerk_user_id', seed.targetA)
    expect(leaked).toEqual([])
  })

  it('an org admin cannot delete a membership: removal is webhook only', async () => {
    // org_members has no delete policy, and now no delete grant either.
    // Membership ends in Clerk and arrives here as an event.
    const { error } = await asAdminA()
      .from('org_members')
      .delete()
      .eq('org_id', orgAId)
      .eq('clerk_user_id', seed.targetA)
    expect(error).not.toBeNull()

    const { data: intact } = await service
      .from('org_members')
      .select('clerk_user_id')
      .eq('org_id', orgAId)
      .eq('clerk_user_id', seed.targetA)
    expect(intact).toHaveLength(1)
  })

  it("an org admin cannot write a membership into another org", async () => {
    // The grant permits the verb; the policy's with check is what refuses the
    // org. Both layers are exercised here, in that order.
    const { error } = await asAdminA().from('org_members').insert({
      org_id: orgBId,
      clerk_user_id: 'user_granttest_planted',
      role: 'owner',
    })
    expect(error).not.toBeNull()

    const { data: planted } = await service
      .from('org_members')
      .select('clerk_user_id')
      .eq('org_id', orgBId)
      .eq('clerk_user_id', 'user_granttest_planted')
    expect(planted).toEqual([])
  })
})

describe('the claim helpers are callable only by the roles whose policies read them', () => {
  // Migration 009 revoked EXECUTE from PUBLIC on both helpers, which is what a
  // function is granted by default: every role, present and future. anon never
  // reaches a policy that calls either, so anon does not get to call them.
  it('anon cannot call clerk_active_org_id', async () => {
    const { error } = await createAnonClient().rpc('clerk_active_org_id')
    expect(error).not.toBeNull()
  })

  it('anon cannot call clerk_is_org_admin', async () => {
    const { error } = await createAnonClient().rpc('clerk_is_org_admin')
    expect(error).not.toBeNull()
  })

  it('a signed in session still reads its own org, which is the whole point', async () => {
    // The guard on the revoke above: if authenticated had lost EXECUTE too,
    // every policy in the schema would fail closed and this would return empty.
    const { data, error } = await asAdminA().from('organizations').select('id')
    expect(error).toBeNull()
    expect((data ?? []).map((o) => o.id)).toEqual([orgAId])
  })
})
