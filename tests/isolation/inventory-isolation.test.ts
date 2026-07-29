import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  CLAIM_SHAPES,
  createAnonClient,
  createMemberClient,
  createServiceClient,
  memberToken,
  preflight,
  type ClaimShape,
  type TestClient,
} from './local-stack'

// Isolation proof for inventory (F15, migration 016). Extends the suite per
// CLAUDE.md rules 2 and 8 (never skip, weaken, or delete). What is under
// test, all enforced at the database, none of it in app code:
//   - ADMIN ONLY, LOUDLY: a member is refused with 42501 on EVERY verb,
//     select included. Inventory is the first table where a member's read
//     must not be a silent empty list (an empty list reads as an empty
//     inventory); the inventory_access_gate() raise is what makes the
//     refusal observable, since both org roles share the authenticated
//     Postgres role and grants alone cannot tell them apart.
//   - THE COLUMN IS THE AUTHORITY: a member token claiming admin is refused
//     all the same.
//   - CROSS ORG: an admin of org A cannot read, edit, move, or delete org
//     B's items; cross org reads are silently empty (the repo convention:
//     no trace another org's rows exist).
//   - ITEM NUMBERS: unique within an org when present, the same number is
//     fine in another org, and unnumbered rows never collide.
//   - AUDIT FANOUT: create, update, and delete each produce exactly one
//     correctly mapped audit row, and no row ever carries notes content.
//   - ANON: refused at the grant layer outright.

const runId = randomUUID()
const seed = {
  orgA: { clerk_org_id: `org_inv_a_${runId}`, name: 'Inventory Test Org A' },
  orgB: { clerk_org_id: `org_inv_b_${runId}`, name: 'Inventory Test Org B' },
  adminA: `user_inv_admin_a_${runId}`,
  memberA: `user_inv_member_a_${runId}`,
  adminB: `user_inv_admin_b_${runId}`,
}

const NOTES_SECRET = `notes-content-${runId} the supplier discount code nobody should see in the log`

let service: TestClient
let orgAId: string
let orgBId: string
let seeded = false

// Filled in beforeAll as adminA creates the fixture items.
let tonerId: string
let cablesId: string

const asUser = (
  clerkUserId: string,
  clerkOrgId: string,
  shape: ClaimShape,
  claimRole?: 'member' | 'admin',
) => createMemberClient(memberToken({ clerkUserId, clerkOrgId, shape, claimRole }))

const asAdminA = () => asUser(seed.adminA, seed.orgA.clerk_org_id, 'legacy')
const asAdminB = () => asUser(seed.adminB, seed.orgB.clerk_org_id, 'legacy')

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
    { org_id: orgAId, clerk_user_id: seed.adminA, role: 'admin', tags: [] },
    { org_id: orgAId, clerk_user_id: seed.memberA, role: 'member', tags: [] },
    { org_id: orgBId, clerk_user_id: seed.adminB, role: 'admin', tags: [] },
  ])
  if (memberErr) throw new Error(`Seeding org_members failed: ${memberErr.message}`)

  // Items created through ADMIN A's OWN RLS session, proving the insert
  // policy as part of seeding. The token claim stays the default member,
  // proving org_members.role, not the claim, is the authority.
  const create = async (row: {
    name: string
    item_number?: string
    quantity: number
    min_stock: number
    notes?: string
  }): Promise<string> => {
    const { data, error } = await asAdminA()
      .from('inventory_items')
      .insert({ org_id: orgAId, ...row })
      .select()
      .single()
    if (error) throw new Error(`Seeding item failed (admin policy?): ${error.message}`)
    return data.id
  }

  tonerId = await create({
    name: 'Toner cartridge',
    item_number: `PRN-${runId.slice(0, 8)}`,
    quantity: 4,
    min_stock: 2,
    notes: NOTES_SECRET,
  })
  cablesId = await create({ name: 'Network cables', quantity: 40, min_stock: 10 })

  seeded = true
}, 60_000)

afterAll(async () => {
  if (!seeded) return
  await service
    .from('organizations')
    .delete()
    .in('clerk_org_id', [seed.orgA.clerk_org_id, seed.orgB.clerk_org_id])
})

describe.each(CLAIM_SHAPES)('members hold no verb, loudly (%s claim shape)', (shape) => {
  it('a member select is refused with 42501, not an empty list', async () => {
    const { data, error } = await asUser(seed.memberA, seed.orgA.clerk_org_id, shape)
      .from('inventory_items')
      .select()
    expect(error).not.toBeNull()
    expect(error!.code).toBe('42501')
    expect(data).toBeNull()
  })

  it('a member select by id is refused the same way', async () => {
    const { error } = await asUser(seed.memberA, seed.orgA.clerk_org_id, shape)
      .from('inventory_items')
      .select()
      .eq('id', tonerId)
      .maybeSingle()
    expect(error).not.toBeNull()
    expect(error!.code).toBe('42501')
  })

  it('a member insert, update, and delete are all refused with 42501', async () => {
    const client = asUser(seed.memberA, seed.orgA.clerk_org_id, shape)

    const ins = await client
      .from('inventory_items')
      .insert({ org_id: orgAId, name: 'Smuggled item', quantity: 1, min_stock: 0 })
    expect(ins.error).not.toBeNull()
    expect(ins.error!.code).toBe('42501')

    const upd = await client
      .from('inventory_items')
      .update({ quantity: 0 })
      .eq('id', tonerId)
    expect(upd.error).not.toBeNull()
    expect(upd.error!.code).toBe('42501')

    const del = await client.from('inventory_items').delete().eq('id', tonerId)
    expect(del.error).not.toBeNull()
    expect(del.error!.code).toBe('42501')

    // Untouched, verified via the service role.
    const { data } = await service
      .from('inventory_items')
      .select('quantity')
      .eq('id', tonerId)
      .single()
    expect(data!.quantity).toBe(4)
  })

  it('a member token claiming admin is refused all the same: the column is the authority', async () => {
    const { error } = await asUser(seed.memberA, seed.orgA.clerk_org_id, shape, 'admin')
      .from('inventory_items')
      .select()
    expect(error).not.toBeNull()
    expect(error!.code).toBe('42501')
  })
})

describe.each(CLAIM_SHAPES)('cross org isolation (%s claim shape)', (shape) => {
  it('an org B admin sees none of org A, list and direct id both, silently', async () => {
    const list = await asUser(seed.adminB, seed.orgB.clerk_org_id, shape)
      .from('inventory_items')
      .select()
    expect(list.error).toBeNull()
    expect(list.data!.every((i) => i.org_id === orgBId)).toBe(true)

    const direct = await asUser(seed.adminB, seed.orgB.clerk_org_id, shape)
      .from('inventory_items')
      .select()
      .eq('id', tonerId)
      .maybeSingle()
    expect(direct.error).toBeNull()
    expect(direct.data).toBeNull()
  })

  it('an org B admin cannot update or delete an org A item: zero rows, A unchanged', async () => {
    await asUser(seed.adminB, seed.orgB.clerk_org_id, shape)
      .from('inventory_items')
      .update({ quantity: 0 })
      .eq('id', tonerId)
    await asUser(seed.adminB, seed.orgB.clerk_org_id, shape)
      .from('inventory_items')
      .delete()
      .eq('id', tonerId)

    const { data } = await service
      .from('inventory_items')
      .select('quantity')
      .eq('id', tonerId)
      .single()
    expect(data!.quantity).toBe(4)
  })

  it('an org B admin cannot insert into org A', async () => {
    const { error } = await asUser(seed.adminB, seed.orgB.clerk_org_id, shape)
      .from('inventory_items')
      .insert({ org_id: orgAId, name: 'Cross org plant', quantity: 1, min_stock: 0 })
    expect(error).not.toBeNull()
  })
})

describe('item numbers are org scoped (ruling 3)', () => {
  it('a duplicate within the org is refused; the same number in another org is fine', async () => {
    const number = `DUP-${runId.slice(0, 8)}`

    const first = await asAdminA()
      .from('inventory_items')
      .insert({ org_id: orgAId, name: 'First holder', item_number: number, quantity: 1, min_stock: 0 })
    expect(first.error).toBeNull()

    const dup = await asAdminA()
      .from('inventory_items')
      .insert({ org_id: orgAId, name: 'Second holder', item_number: number, quantity: 1, min_stock: 0 })
    expect(dup.error).not.toBeNull()
    expect(dup.error!.code).toBe('23505')

    const otherOrg = await asAdminB()
      .from('inventory_items')
      .insert({ org_id: orgBId, name: 'B holder', item_number: number, quantity: 1, min_stock: 0 })
    expect(otherOrg.error).toBeNull()
  })

  it('unnumbered rows never collide with each other', async () => {
    // The seed already holds one unnumbered row (Network cables); a second
    // NULL item_number must not trip the partial unique index.
    const { error } = await asAdminA()
      .from('inventory_items')
      .insert({ org_id: orgAId, name: 'Unnumbered spare', quantity: 1, min_stock: 0 })
    expect(error).toBeNull()
  })
})

describe('audit fanout: one correctly mapped row per action, no notes content', () => {
  it('every seed create recorded exactly one inventory_item_created row as adminA', async () => {
    const { data, error } = await service
      .from('audit_log')
      .select()
      .eq('org_id', orgAId)
      .eq('action', 'inventory_item_created')
    expect(error).toBeNull()
    // 2 fixture items + First holder + the unnumbered spare; the refused
    // duplicate recorded nothing (its transaction aborted) and B holder
    // belongs to org B's log.
    expect(data).toHaveLength(4)
    expect(data!.every((r) => r.actor === seed.adminA)).toBe(true)
    expect(data!.map((r) => (r.detail as { name: string }).name)).toContain(
      'Toner cartridge',
    )
  })

  it('an edit records one inventory_item_updated row naming the changed fields, not the content', async () => {
    const { error } = await asAdminA()
      .from('inventory_items')
      .update({ quantity: 1, notes: `${NOTES_SECRET} updated` })
      .eq('id', tonerId)
    expect(error).toBeNull()

    const { data } = await service
      .from('audit_log')
      .select()
      .eq('org_id', orgAId)
      .eq('action', 'inventory_item_updated')
    expect(data).toHaveLength(1)
    expect(data![0].actor).toBe(seed.adminA)
    expect(data![0].detail).toEqual({
      name: 'Toner cartridge',
      changed: ['notes', 'quantity'],
    })
  })

  it('a save that changes nothing records nothing', async () => {
    const { error } = await asAdminA()
      .from('inventory_items')
      .update({ quantity: 1 })
      .eq('id', tonerId)
    expect(error).toBeNull()

    const { data } = await service
      .from('audit_log')
      .select('id')
      .eq('org_id', orgAId)
      .eq('action', 'inventory_item_updated')
    expect(data).toHaveLength(1)
  })

  it('a delete records one inventory_item_deleted row with the name', async () => {
    const { error } = await asAdminA()
      .from('inventory_items')
      .delete()
      .eq('id', cablesId)
    expect(error).toBeNull()

    const { data } = await service
      .from('audit_log')
      .select()
      .eq('org_id', orgAId)
      .eq('action', 'inventory_item_deleted')
    expect(data).toHaveLength(1)
    expect(data![0].actor).toBe(seed.adminA)
    expect(data![0].detail).toEqual({ name: 'Network cables' })
  })

  it('no audit row anywhere carries notes content', async () => {
    const { data } = await service.from('audit_log').select().eq('org_id', orgAId)
    expect(data!.length).toBeGreaterThan(0)
    for (const row of data!) {
      expect(JSON.stringify(row.detail)).not.toContain(NOTES_SECRET.slice(0, 20))
    }
  })
})

describe('anon holds nothing', () => {
  it('an anonymous caller is refused at the grant layer, not filtered to empty', async () => {
    const { error } = await createAnonClient().from('inventory_items').select()
    expect(error).not.toBeNull()
    expect(error!.code).toBe('42501')
  })
})
