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

// Isolation proof for the audit log (BRD F12, migration 013). Extends the
// suite per CLAUDE.md rules 2 and 8 (never skip, weaken, or delete). What is
// under test, all enforced at the database:
//   - TRIGGER WRITTEN: the sensitive actions the vocabulary names each
//     produce exactly one correctly mapped row, whether the writer is a user
//     session (actor = their Clerk id) or the service role (actor NULL, the
//     webhook shape).
//   - APPEND ONLY: no session can insert, update, or delete log rows, admins
//     included; the grants withhold the verbs entirely. Above the grants,
//     the block rewrite trigger raises on update and delete for EVERY
//     caller, service role included, so history cannot be rewritten even by
//     the role that bypasses RLS; the one carve out is the org cascade,
//     where the log dies with its org.
//   - SETTINGS FANOUT: the status page opt in, the usage timezone, and the
//     notification settings each record their change with the changed field
//     names and never the values, and only on a real change.
//   - ADMIN ONLY, ORG SCOPED: members read nothing; admins read their own
//     org's log and see zero rows of another org's.
//   - NO SECRETS: key rows carry provider and last four only, never the
//     ciphertext column's content.
//   - ORG DELETE SAFE: deleting an org that still owns audited entities does
//     not trip the fanout triggers into breaking the cascade.

const runId = randomUUID()
const seed = {
  orgA: { clerk_org_id: `org_audit_a_${runId}`, name: 'Audit Test Org A' },
  orgB: { clerk_org_id: `org_audit_b_${runId}`, name: 'Audit Test Org B' },
  adminA: `user_audit_admin_a_${runId}`,
  memberA: `user_audit_member_a_${runId}`,
  adminB: `user_audit_admin_b_${runId}`,
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

const FAKE_CIPHERTEXT = `not-a-real-ciphertext-${runId}`

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

  seeded = true
}, 60_000)

afterAll(async () => {
  if (!seeded) return
  await service
    .from('organizations')
    .delete()
    .in('clerk_org_id', [seed.orgA.clerk_org_id, seed.orgB.clerk_org_id])
})

const auditRowsA = (action?: string) => {
  let q = service.from('audit_log').select().eq('org_id', orgAId)
  if (action) q = q.eq('action', action)
  return q
}

describe('the fanout records each sensitive action exactly once', () => {
  it('a role change by the service role (the webhook path) records actor NULL', async () => {
    const { error } = await service
      .from('org_members')
      .update({ role: 'technician' })
      .eq('org_id', orgAId)
      .eq('clerk_user_id', seed.memberA)
    expect(error).toBeNull()

    const { data } = await auditRowsA('member_role_changed')
    expect(data).toHaveLength(1)
    expect(data![0].actor).toBeNull()
    expect(data![0].detail).toEqual({
      target_user_id: seed.memberA,
      old_role: 'member',
      new_role: 'technician',
    })
  })

  it('an unchanged role write (the idempotent webhook redelivery) records nothing', async () => {
    const { error } = await service
      .from('org_members')
      .update({ role: 'technician' })
      .eq('org_id', orgAId)
      .eq('clerk_user_id', seed.memberA)
    expect(error).toBeNull()
    const { data } = await auditRowsA('member_role_changed')
    expect(data).toHaveLength(1)
  })

  it('no session can change a role since migration 014, so the webhook is the only role writer', async () => {
    // Migration 014 removed the vestigial 001 correction path when it added
    // the tags column grant: role updates are refused at the grant for every
    // authenticated session, admin claim or not, and only the service role
    // (the Clerk webhook) changes roles. The audit trail therefore records
    // role changes with actor NULL, the system.
    const { error } = await asUser(seed.adminA, seed.orgA.clerk_org_id, 'legacy', 'admin')
      .from('org_members')
      .update({ role: 'member' })
      .eq('org_id', orgAId)
      .eq('clerk_user_id', seed.memberA)
    expect(error).not.toBeNull()
    expect(error!.code).toBe('42501')

    const { data } = await auditRowsA('member_role_changed')
    expect(data).toHaveLength(1)
  })

  it('the key lifecycle records added, replaced, deleted with provider and last four only', async () => {
    const asAdminA = asUser(seed.adminA, seed.orgA.clerk_org_id, 'v2')
    await asAdminA.from('org_api_keys').insert({
      org_id: orgAId,
      provider: 'openai',
      encrypted_key: FAKE_CIPHERTEXT,
      key_last_four: 'ai-1',
      added_by: seed.adminA,
    })
    await asAdminA
      .from('org_api_keys')
      .update({ encrypted_key: `${FAKE_CIPHERTEXT}-2`, key_last_four: 'ai-2' })
      .eq('org_id', orgAId)
      .eq('provider', 'openai')
    await asAdminA
      .from('org_api_keys')
      .delete()
      .eq('org_id', orgAId)
      .eq('provider', 'openai')

    const { data } = await service
      .from('audit_log')
      .select()
      .eq('org_id', orgAId)
      .in('action', ['api_key_added', 'api_key_replaced', 'api_key_deleted'])
      .order('occurred_at', { ascending: true })
    expect(data!.map((r) => r.action)).toEqual([
      'api_key_added',
      'api_key_replaced',
      'api_key_deleted',
    ])
    for (const row of data!) {
      expect(row.actor).toBe(seed.adminA)
      const detail = row.detail as Record<string, unknown>
      expect(detail.provider).toBe('openai')
      expect(Object.keys(detail).sort()).toEqual(['key_last_four', 'provider'])
      // The one thing this log must never carry.
      expect(JSON.stringify(row)).not.toContain(FAKE_CIPHERTEXT)
    }
  })

  it('enabling the status page records the flip with field names, never the slug value', async () => {
    const slug = `audit-slug-${runId.slice(0, 8)}`
    const { error } = await asUser(seed.adminA, seed.orgA.clerk_org_id, 'legacy')
      .from('organizations')
      .update({ status_page_enabled: true, status_page_slug: slug })
      .eq('id', orgAId)
    expect(error).toBeNull()

    const { data } = await auditRowsA('status_page_enabled')
    expect(data).toHaveLength(1)
    expect(data![0].actor).toBe(seed.adminA)
    expect(data![0].detail).toEqual({
      changed: ['status_page_enabled', 'status_page_slug'],
    })
    // Field names are the whole detail: the value never reaches the log.
    expect(JSON.stringify(data![0])).not.toContain(slug)
  })

  it('a slug rename while enabled is its own action; disable is another; no values anywhere', async () => {
    const asAdminA = asUser(seed.adminA, seed.orgA.clerk_org_id, 'v2')
    const renamed = `audit-slug-b-${runId.slice(0, 8)}`
    await asAdminA
      .from('organizations')
      .update({ status_page_slug: renamed })
      .eq('id', orgAId)
    await asAdminA
      .from('organizations')
      .update({ status_page_enabled: false })
      .eq('id', orgAId)

    const slugRows = await auditRowsA('status_page_slug_changed')
    expect(slugRows.data).toHaveLength(1)
    expect(slugRows.data![0].detail).toEqual({ changed: ['status_page_slug'] })
    expect(JSON.stringify(slugRows.data![0])).not.toContain(renamed)

    const disabled = await auditRowsA('status_page_disabled')
    expect(disabled.data).toHaveLength(1)
    expect(disabled.data![0].detail).toEqual({ changed: ['status_page_enabled'] })
  })

  it('a timezone change records once, and an unchanged write records nothing', async () => {
    const asAdminA = asUser(seed.adminA, seed.orgA.clerk_org_id, 'legacy')
    for (let i = 0; i < 2; i += 1) {
      const { error } = await asAdminA
        .from('organizations')
        .update({ timezone: 'America/New_York' })
        .eq('id', orgAId)
      expect(error).toBeNull()
    }

    const { data } = await auditRowsA('timezone_changed')
    expect(data).toHaveLength(1)
    expect(data![0].actor).toBe(seed.adminA)
    expect(data![0].detail).toEqual({ changed: ['timezone'] })
    expect(JSON.stringify(data![0])).not.toContain('America/New_York')
  })

  it('the webhook name upsert touches no audited column and records nothing', async () => {
    const { error } = await service
      .from('organizations')
      .update({ name: 'Audit Test Org A renamed' })
      .eq('id', orgAId)
    expect(error).toBeNull()
    const { data } = await service
      .from('audit_log')
      .select('action')
      .eq('org_id', orgAId)
      .in('action', [
        'status_page_enabled',
        'status_page_disabled',
        'status_page_slug_changed',
        'timezone_changed',
      ])
    // Still exactly the four rows the tests above created: enable, rename,
    // disable, and the timezone change.
    expect(data).toHaveLength(4)
  })

  it('notification settings changes record changed field names, never destinations', async () => {
    const email = `alerts-${runId.slice(0, 8)}@example.com`
    const asAdminA = asUser(seed.adminA, seed.orgA.clerk_org_id, 'v2')
    // Creating the row is configuration appearing, not changing: AFTER
    // UPDATE only, so the insert records nothing.
    const ins = await asAdminA.from('org_notification_settings').insert({
      org_id: orgAId,
      notification_email: email,
    })
    expect(ins.error).toBeNull()

    const upd = await asAdminA
      .from('org_notification_settings')
      .update({ notification_email: `b-${email}`, email_on_open: false })
      .eq('org_id', orgAId)
    expect(upd.error).toBeNull()

    // An unchanged write records nothing.
    const same = await asAdminA
      .from('org_notification_settings')
      .update({ email_on_open: false })
      .eq('org_id', orgAId)
    expect(same.error).toBeNull()

    const { data } = await auditRowsA('notification_settings_changed')
    expect(data).toHaveLength(1)
    expect(data![0].actor).toBe(seed.adminA)
    expect(data![0].detail).toEqual({
      changed: ['email_on_open', 'notification_email'],
    })
    expect(JSON.stringify(data![0])).not.toContain(email)
  })

  it('deleting a monitor records the deletion with the monitor name', async () => {
    const { data: monitor, error: monErr } = await service
      .from('monitors')
      .insert({ org_id: orgAId, name: 'Doomed Monitor', url: 'https://example.com' })
      .select()
      .single()
    expect(monErr).toBeNull()

    const { error } = await asUser(seed.adminA, seed.orgA.clerk_org_id, 'legacy')
      .from('monitors')
      .delete()
      .eq('id', monitor!.id)
    expect(error).toBeNull()

    const { data } = await auditRowsA('monitor_deleted')
    expect(data).toHaveLength(1)
    expect(data![0].actor).toBe(seed.adminA)
    expect(data![0].detail).toEqual({ name: 'Doomed Monitor' })
  })
})

describe('the log is append only for every session', () => {
  it.each(CLAIM_SHAPES)('no direct insert, even as an admin (%s)', async (shape) => {
    const { error } = await asUser(seed.adminA, seed.orgA.clerk_org_id, shape)
      .from('audit_log')
      .insert({ org_id: orgAId, action: 'monitor_deleted', detail: { name: 'forged' } })
    expect(error).not.toBeNull()
    expect(error!.code).toBe('42501')
  })

  it('no update and no delete, even as an admin', async () => {
    const asAdminA = asUser(seed.adminA, seed.orgA.clerk_org_id, 'legacy')
    const upd = await asAdminA
      .from('audit_log')
      .update({ action: 'monitor_deleted' })
      .eq('org_id', orgAId)
    expect(upd.error).not.toBeNull()
    expect(upd.error!.code).toBe('42501')
    const del = await asAdminA.from('audit_log').delete().eq('org_id', orgAId)
    expect(del.error).not.toBeNull()
    expect(del.error!.code).toBe('42501')
  })

  it('not even the service role can rewrite history: update and delete raise', async () => {
    // Grants stop the API roles; the block rewrite trigger stops the one
    // role grants cannot, because the service role bypasses RLS and holds
    // ALL. History survives everything except its org's own deletion.
    const { count } = await service
      .from('audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgAId)
    expect(count).toBeGreaterThan(0)

    const upd = await service
      .from('audit_log')
      .update({ action: 'monitor_deleted' })
      .eq('org_id', orgAId)
    expect(upd.error).not.toBeNull()
    expect(upd.error!.message).toContain('append only')

    const del = await service.from('audit_log').delete().eq('org_id', orgAId)
    expect(del.error).not.toBeNull()
    expect(del.error!.message).toContain('append only')

    const after = await service
      .from('audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgAId)
    expect(after.count).toBe(count)
  })
})

describe.each(CLAIM_SHAPES)('admin only, org scoped reads (%s claim shape)', (shape) => {
  it('an org A admin reads org A rows', async () => {
    const { data, error } = await asUser(seed.adminA, seed.orgA.clerk_org_id, shape)
      .from('audit_log')
      .select()
    expect(error).toBeNull()
    expect(data!.length).toBeGreaterThan(0)
    expect(data!.every((r) => r.org_id === orgAId)).toBe(true)
  })

  it('a member reads nothing, even with an admin token claim', async () => {
    const plain = await asUser(seed.memberA, seed.orgA.clerk_org_id, shape)
      .from('audit_log')
      .select()
    expect(plain.error).toBeNull()
    expect(plain.data).toEqual([])
    // The database column, not the claim, is the role authority.
    const claiming = await asUser(seed.memberA, seed.orgA.clerk_org_id, shape, 'admin')
      .from('audit_log')
      .select()
    expect(claiming.error).toBeNull()
    expect(claiming.data).toEqual([])
  })

  it('an org B admin sees zero org A rows', async () => {
    const { data, error } = await asUser(seed.adminB, seed.orgB.clerk_org_id, shape)
      .from('audit_log')
      .select()
    expect(error).toBeNull()
    expect(data!.every((r) => r.org_id === orgBId)).toBe(true)
    expect(data!.some((r) => r.org_id === orgAId)).toBe(false)
  })
})

describe('org deletion still works with audited entities in place', () => {
  it('an org owning a monitor and a key deletes cleanly, log included', async () => {
    const { data: org, error: orgErr } = await service
      .from('organizations')
      .insert({ clerk_org_id: `org_audit_doomed_${runId}`, name: 'Doomed Org' })
      .select()
      .single()
    expect(orgErr).toBeNull()
    await service.from('monitors').insert({
      org_id: org!.id,
      name: 'Doomed org monitor',
      url: 'https://example.com',
    })
    await service.from('org_api_keys').insert({
      org_id: org!.id,
      provider: 'google',
      encrypted_key: FAKE_CIPHERTEXT,
      key_last_four: 'oogl',
      added_by: seed.adminA,
    })

    // The webhook shape: one delete, cascading through every child table and
    // firing the fanout triggers mid cascade. Migration 013 makes them skip
    // when the org row is already gone, so this must succeed.
    const { error } = await service.from('organizations').delete().eq('id', org!.id)
    expect(error).toBeNull()

    const { data } = await service.from('audit_log').select('id').eq('org_id', org!.id)
    expect(data).toEqual([])
  })
})
