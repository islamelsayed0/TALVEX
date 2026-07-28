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

// Isolation proof for notification settings (F10, migration 010). Extends the
// suite per CLAUDE.md rules 2 and 8 (never skip, weaken, or delete). Under
// test, all enforced at the database:
//   - ADMIN ONLY: a member has no useful access to org_notification_settings:
//     select returns nothing, insert and update are refused or match zero
//     rows. Admins (per org_members.role, not the token claim) manage.
//   - CROSS ORG: an admin of org B reads nothing of org A's settings and
//     cannot write into A.
//   - NO DELETE: the delete verb is not granted to authenticated at all; the
//     row dies only with the org cascade.
//   - CRON COLUMN: incidents.last_notified_at is service role only, like
//     every other cron managed column; no user session can write incidents.

const runId = randomUUID()
const seed = {
  orgA: { clerk_org_id: `org_notif_a_${runId}`, name: 'Notif Test Org A' },
  orgB: { clerk_org_id: `org_notif_b_${runId}`, name: 'Notif Test Org B' },
  adminA: `user_notif_admin_a_${runId}`,
  memberA: `user_notif_member_a_${runId}`,
  adminB: `user_notif_admin_b_${runId}`,
}

const WEBHOOK_A = 'https://discord.com/api/webhooks/1111/fake-a'

let service: TestClient
let orgAId: string
let orgBId: string
let incidentAId: string
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

  // Seed org A's settings through ADMIN A's OWN RLS session, proving admins
  // can manage. The token claim stays the default member, proving the
  // database column (org_members.role = admin) is the authority.
  const { error: insErr } = await asUser(seed.adminA, seed.orgA.clerk_org_id, 'legacy')
    .from('org_notification_settings')
    .insert({
      org_id: orgAId,
      notification_email: 'ops-a@example.com',
      discord_webhook: WEBHOOK_A,
    })
  if (insErr) {
    throw new Error(`Seeding org A settings as admin failed (admin policy?): ${insErr.message}`)
  }

  // An incident to prove last_notified_at is service role only. The cron
  // path is the only production writer of both rows.
  const { data: monitor, error: monErr } = await service
    .from('monitors')
    .insert({ org_id: orgAId, name: 'Notif Monitor A', url: 'https://example.com' })
    .select('id')
    .single()
  if (monErr) throw new Error(`Seeding monitor failed: ${monErr.message}`)
  const { data: incident, error: incErr } = await service
    .from('incidents')
    .insert({
      org_id: orgAId,
      monitor_id: monitor.id,
      status: 'open',
      opened_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (incErr) throw new Error(`Seeding incident failed: ${incErr.message}`)
  incidentAId = incident.id

  seeded = true
}, 60_000)

afterAll(async () => {
  if (!seeded) return
  await service
    .from('organizations')
    .delete()
    .in('clerk_org_id', [seed.orgA.clerk_org_id, seed.orgB.clerk_org_id])
})

describe('admins manage their own org settings', () => {
  it('an admin reads and updates the row', async () => {
    const asAdminA = asUser(seed.adminA, seed.orgA.clerk_org_id, 'v2')
    const { data, error } = await asAdminA
      .from('org_notification_settings')
      .select('notification_email, email_on_open, alert_cooldown_minutes')
    expect(error).toBeNull()
    expect(data).toEqual([
      { notification_email: 'ops-a@example.com', email_on_open: true, alert_cooldown_minutes: 30 },
    ])

    const { error: upErr } = await asAdminA
      .from('org_notification_settings')
      .update({ alert_cooldown_minutes: 45 })
      .eq('org_id', orgAId)
    expect(upErr).toBeNull()
    const { data: after } = await service
      .from('org_notification_settings')
      .select('alert_cooldown_minutes')
      .eq('org_id', orgAId)
      .single()
    expect(after!.alert_cooldown_minutes).toBe(45)
  })

  it('no session holds the delete verb, admin included', async () => {
    const { error } = await asUser(seed.adminA, seed.orgA.clerk_org_id, 'legacy')
      .from('org_notification_settings')
      .delete()
      .eq('org_id', orgAId)
    expect(error).not.toBeNull()
    const { data } = await service
      .from('org_notification_settings')
      .select('org_id')
      .eq('org_id', orgAId)
    expect(data).toHaveLength(1)
  })
})

describe.each(CLAIM_SHAPES)('members have no access (%s claim shape)', (shape) => {
  const asMemberA = () => asUser(seed.memberA, seed.orgA.clerk_org_id, shape)

  it('a member cannot select the settings, even in their own org', async () => {
    const { data, error } = await asMemberA()
      .from('org_notification_settings')
      .select('notification_email')
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('a member cannot insert a settings row', async () => {
    const { error } = await asMemberA().from('org_notification_settings').insert({
      org_id: orgBId,
      notification_email: 'member-smuggled@example.com',
    })
    expect(error).not.toBeNull()
  })

  it('a member cannot update the existing row (matches zero rows)', async () => {
    await asMemberA()
      .from('org_notification_settings')
      .update({ notification_email: 'hijacked@example.com' })
      .eq('org_id', orgAId)
    const { data } = await service
      .from('org_notification_settings')
      .select('notification_email')
      .eq('org_id', orgAId)
      .single()
    expect(data!.notification_email).toBe('ops-a@example.com')
  })

  it('an admin token CLAIM does not grant access when the column says member', async () => {
    const claimingAdmin = asUser(seed.memberA, seed.orgA.clerk_org_id, shape, 'admin')
    const { data } = await claimingAdmin.from('org_notification_settings').select('org_id')
    expect(data).toEqual([])
    const { error } = await claimingAdmin.from('org_notification_settings').insert({
      org_id: orgAId,
      notification_email: 'claimed@example.com',
    })
    expect(error).not.toBeNull()
  })
})

describe.each(CLAIM_SHAPES)('cross org isolation (%s claim shape)', (shape) => {
  it('org B admin sees nothing of org A settings', async () => {
    const { data, error } = await asUser(seed.adminB, seed.orgB.clerk_org_id, shape)
      .from('org_notification_settings')
      .select('notification_email')
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('org B admin cannot write a settings row into org A', async () => {
    const { error } = await asUser(seed.adminB, seed.orgB.clerk_org_id, shape)
      .from('org_notification_settings')
      .insert({ org_id: orgAId, notification_email: 'cross-org@example.com' })
    expect(error).not.toBeNull()
  })

  it('org B admin cannot rewrite org A settings (matches zero rows)', async () => {
    await asUser(seed.adminB, seed.orgB.clerk_org_id, shape)
      .from('org_notification_settings')
      .update({ discord_webhook: 'https://discord.com/api/webhooks/9/hijack' })
      .eq('org_id', orgAId)
    const { data } = await service
      .from('org_notification_settings')
      .select('discord_webhook')
      .eq('org_id', orgAId)
      .single()
    expect(data!.discord_webhook).toBe(WEBHOOK_A)
  })
})

describe.each(CLAIM_SHAPES)('incidents.last_notified_at is service role only (%s)', (shape) => {
  it('no user session can write it, admin of the owning org included', async () => {
    const { data: before } = await service
      .from('incidents')
      .select('last_notified_at')
      .eq('id', incidentAId)
      .single()
    const { error } = await asUser(seed.adminA, seed.orgA.clerk_org_id, shape)
      .from('incidents')
      .update({ last_notified_at: new Date().toISOString() })
      .eq('id', incidentAId)
    // The authenticated role has no update grant on incidents at all, so
    // this is refused at the verb (42501), not silently filtered.
    expect(error).not.toBeNull()
    const { data: after } = await service
      .from('incidents')
      .select('last_notified_at')
      .eq('id', incidentAId)
      .single()
    expect(after!.last_notified_at).toBe(before!.last_notified_at)
  })

  it('the service role writes it, as the cron path does', async () => {
    const stamp = new Date().toISOString()
    const { error } = await service
      .from('incidents')
      .update({ last_notified_at: stamp })
      .eq('id', incidentAId)
    expect(error).toBeNull()
    const { data } = await service
      .from('incidents')
      .select('last_notified_at')
      .eq('id', incidentAId)
      .single()
    expect(data!.last_notified_at).not.toBeNull()
  })
})
