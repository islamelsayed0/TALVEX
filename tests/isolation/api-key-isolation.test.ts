import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { decryptApiKey, encryptApiKey } from '@/lib/chat/encryption'
import {
  CLAIM_SHAPES,
  createMemberClient,
  createServiceClient,
  memberToken,
  type ClaimShape,
  type TestClient,
} from './local-stack'
import { preflight } from './local-stack'

// Isolation proof for the BYOK key vault (Phase 1 Task 5), the most sensitive
// table in the product. Extends the suite per CLAUDE.md rules 2 and 8 (never
// skip, weaken, or delete). Rulings under test, all enforced at the database:
//   - Ruling 6, ADMIN ONLY: a member has no access to org_api_keys at all, not
//     even select. Admins (per org_members.role, not the token claim) manage.
//   - Ruling 3, NO CIPHERTEXT TO CLIENTS: the encrypted_key column is not in
//     the authenticated SELECT grant, so not even an admin can read it through
//     RLS; only the service role can.
//   - Ruling 2, ENCRYPTED AT REST: the stored column never contains the
//     plaintext; it decrypts back to the known key.
//   - THE TRAIL: api_key_events is trigger written, unwritable directly by
//     anyone (like ticket_events), and admin readable, org scoped.
//   - CROSS ORG: org B sees nothing of org A's keys or trail, and cannot write
//     into A.
//   - PRESENCE HELPERS: members with zero table access still learn, via the
//     SECURITY DEFINER functions, that their org has a key and which providers.
//
// Obviously fake key material only; no real provider keys anywhere.
const TEST_SECRET = 'a1b2c3d4'.repeat(8) // 64 hex = 32 bytes // gitleaks:allow
process.env.API_KEY_ENCRYPTION_SECRET = TEST_SECRET

const KNOWN_KEY_A = 'FAKEKEY-orgA-abcdefghijklmnop-1234'

const runId = randomUUID()
const seed = {
  orgA: { clerk_org_id: `org_key_a_${runId}`, name: 'Key Test Org A' },
  orgB: { clerk_org_id: `org_key_b_${runId}`, name: 'Key Test Org B' },
  adminA: `user_key_admin_a_${runId}`,
  memberA: `user_key_member_a_${runId}`,
  adminB: `user_key_admin_b_${runId}`,
}

let service: TestClient
let orgAId: string
let orgBId: string
let seeded = false

const asUser = (
  clerkUserId: string,
  clerkOrgId: string,
  shape: ClaimShape,
  claimRole?: 'member' | 'admin',
) => createMemberClient(memberToken({ clerkUserId, clerkOrgId, shape, claimRole }))

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
    { org_id: orgBId, clerk_user_id: seed.adminB, role: 'admin' },
  ])
  if (memberErr) throw new Error(`Seeding org_members failed: ${memberErr.message}`)

  // Seed org A's key through ADMIN A's OWN RLS session, proving admins can
  // manage and the trail fires. If the admin policy were broken this fails
  // loudly here. The token claim is left as the default member, proving the
  // database column (org_members.role = admin), not the claim, is the authority.
  const { error: insErr } = await asUser(seed.adminA, seed.orgA.clerk_org_id, 'legacy')
    .from('org_api_keys')
    .insert({
      org_id: orgAId,
      provider: 'anthropic',
      encrypted_key: encryptApiKey(KNOWN_KEY_A),
      key_last_four: KNOWN_KEY_A.slice(-4),
      added_by: seed.adminA,
    })
  if (insErr) {
    throw new Error(`Seeding org A key as admin failed (admin policy?): ${insErr.message}`)
  }

  seeded = true
}, 60_000)

afterAll(async () => {
  if (!seeded) return
  await service
    .from('organizations')
    .delete()
    .in('clerk_org_id', [seed.orgA.clerk_org_id, seed.orgB.clerk_org_id])
})

describe('encrypted at rest (ruling 2)', () => {
  it('the stored column is ciphertext, never the plaintext, and decrypts back', async () => {
    const { data, error } = await service
      .from('org_api_keys')
      .select('encrypted_key, key_last_four')
      .eq('org_id', orgAId)
      .eq('provider', 'anthropic')
      .single()
    expect(error).toBeNull()
    expect(data!.encrypted_key).not.toBe(KNOWN_KEY_A)
    expect(data!.encrypted_key).not.toContain(KNOWN_KEY_A)
    expect(data!.key_last_four).toBe(KNOWN_KEY_A.slice(-4))
    // The service role, and only it, decrypts server side.
    expect(decryptApiKey(data!.encrypted_key)).toBe(KNOWN_KEY_A)
  })
})

describe('the trail is trigger written and append only', () => {
  it('the seed insert produced an added event carrying provider and last four', async () => {
    const { data, error } = await service
      .from('api_key_events')
      .select('event_type, provider, key_last_four, actor')
      .eq('org_id', orgAId)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data![0]).toEqual({
      event_type: 'added',
      provider: 'anthropic',
      key_last_four: KNOWN_KEY_A.slice(-4),
      actor: seed.adminA,
    })
  })

  it('nobody can write the trail directly, not even an admin', async () => {
    const { error } = await asUser(seed.adminA, seed.orgA.clerk_org_id, 'v2')
      .from('api_key_events')
      .insert({
        org_id: orgAId,
        event_type: 'added',
        provider: 'openai',
        key_last_four: '9999',
        actor: seed.adminA,
      })
    expect(error).not.toBeNull()
  })
})

describe.each(CLAIM_SHAPES)('members have no access at all (%s claim shape)', (shape) => {
  const asMemberA = () => asUser(seed.memberA, seed.orgA.clerk_org_id, shape)

  it('a member cannot select keys, even in their own org', async () => {
    const { data, error } = await asMemberA().from('org_api_keys').select('provider')
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('a member cannot read the key trail', async () => {
    const { data, error } = await asMemberA().from('api_key_events').select('event_type')
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('a member cannot insert a key', async () => {
    const { error } = await asMemberA().from('org_api_keys').insert({
      org_id: orgAId,
      provider: 'google',
      encrypted_key: encryptApiKey('FAKEKEY-member-google'),
      key_last_four: 'ogle',
      added_by: seed.memberA,
    })
    expect(error).not.toBeNull()
  })

  it('a member cannot update or delete the existing key (matches zero rows)', async () => {
    await asMemberA()
      .from('org_api_keys')
      .update({ key_last_four: 'HACK' })
      .eq('org_id', orgAId)
      .eq('provider', 'anthropic')
    await asMemberA()
      .from('org_api_keys')
      .delete()
      .eq('org_id', orgAId)
      .eq('provider', 'anthropic')
    // Untouched, verified via service role.
    const { data } = await service
      .from('org_api_keys')
      .select('key_last_four')
      .eq('org_id', orgAId)
      .eq('provider', 'anthropic')
      .single()
    expect(data!.key_last_four).toBe(KNOWN_KEY_A.slice(-4))
  })

  it('an admin token CLAIM does not grant access when the column says member', async () => {
    // Same member, but their token now claims org admin. The database column
    // (org_members.role = member) is the authority, so this still fails.
    const claimingAdmin = asUser(seed.memberA, seed.orgA.clerk_org_id, shape, 'admin')
    const { data } = await claimingAdmin.from('org_api_keys').select('provider')
    expect(data).toEqual([])
    const { error } = await claimingAdmin.from('org_api_keys').insert({
      org_id: orgAId,
      provider: 'openai',
      encrypted_key: encryptApiKey('FAKEKEY-claim'),
      key_last_four: 'laim',
      added_by: seed.memberA,
    })
    expect(error).not.toBeNull()
  })
})

describe('an admin cannot read the ciphertext through RLS (ruling 3)', () => {
  it('selecting encrypted_key as an admin is refused at the column grant', async () => {
    const { error } = await asUser(seed.adminA, seed.orgA.clerk_org_id, 'legacy')
      .from('org_api_keys')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .select('encrypted_key' as any)
    expect(error).not.toBeNull()
  })

  it('an admin can still read provider and last four', async () => {
    const { data, error } = await asUser(seed.adminA, seed.orgA.clerk_org_id, 'v2')
      .from('org_api_keys')
      .select('provider, key_last_four')
    expect(error).toBeNull()
    expect(data).toEqual([{ provider: 'anthropic', key_last_four: KNOWN_KEY_A.slice(-4) }])
  })
})

describe.each(CLAIM_SHAPES)('cross org isolation (%s claim shape)', (shape) => {
  it('org B admin sees nothing of org A keys or trail', async () => {
    const asAdminB = asUser(seed.adminB, seed.orgB.clerk_org_id, shape)
    const keys = await asAdminB.from('org_api_keys').select('provider')
    expect(keys.error).toBeNull()
    expect(keys.data).toEqual([])
    const events = await asAdminB.from('api_key_events').select('event_type')
    expect(events.error).toBeNull()
    expect(events.data).toEqual([])
  })

  it('org B admin cannot write a key into org A', async () => {
    const { error } = await asUser(seed.adminB, seed.orgB.clerk_org_id, shape)
      .from('org_api_keys')
      .insert({
        org_id: orgAId, // A's org, out of bounds for B
        provider: 'openai',
        encrypted_key: encryptApiKey('FAKEKEY-cross-org'),
        key_last_four: 'org1',
        added_by: seed.adminB,
      })
    expect(error).not.toBeNull()
    // A is unchanged: still exactly one key.
    const { data } = await service.from('org_api_keys').select('id').eq('org_id', orgAId)
    expect(data).toHaveLength(1)
  })
})

describe.each(CLAIM_SHAPES)('presence helpers leak only a boolean and a list (%s)', (shape) => {
  it('a member with no table access still learns their org has an anthropic key', async () => {
    const asMemberA = asUser(seed.memberA, seed.orgA.clerk_org_id, shape)
    const has = await asMemberA.rpc('org_has_api_key')
    expect(has.error).toBeNull()
    expect(has.data).toBe(true)
    const providers = await asMemberA.rpc('org_api_key_providers')
    expect(providers.error).toBeNull()
    expect(providers.data).toEqual(['anthropic'])
  })

  it('org B (no key) sees false and an empty list', async () => {
    const asAdminB = asUser(seed.adminB, seed.orgB.clerk_org_id, shape)
    const has = await asAdminB.rpc('org_has_api_key')
    expect(has.data).toBe(false)
    const providers = await asAdminB.rpc('org_api_key_providers')
    expect(providers.data).toEqual([])
  })
})

describe('the admin lifecycle writes the full trail', () => {
  it('replace then delete records replaced and deleted', async () => {
    // A fresh provider so this does not disturb the anthropic assertions above.
    const asAdminA = asUser(seed.adminA, seed.orgA.clerk_org_id, 'legacy')
    await asAdminA.from('org_api_keys').insert({
      org_id: orgAId,
      provider: 'openai',
      encrypted_key: encryptApiKey('FAKEKEY-openai-1'),
      key_last_four: 'ai-1',
      added_by: seed.adminA,
    })
    await asAdminA
      .from('org_api_keys')
      .update({ encrypted_key: encryptApiKey('FAKEKEY-openai-2'), key_last_four: 'ai-2' })
      .eq('org_id', orgAId)
      .eq('provider', 'openai')
    await asAdminA
      .from('org_api_keys')
      .delete()
      .eq('org_id', orgAId)
      .eq('provider', 'openai')

    const { data } = await service
      .from('api_key_events')
      .select('event_type')
      .eq('org_id', orgAId)
      .eq('provider', 'openai')
      .order('occurred_at', { ascending: true })
    expect(data!.map((e) => e.event_type)).toEqual(['added', 'replaced', 'deleted'])
  })
})
