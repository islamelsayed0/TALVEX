import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { interleaveTrail } from '@/lib/db/tickets'
import { isLowStock } from '@/lib/db/inventory'
import {
  composeDigest,
  digestSection,
  isAwaitingReply,
  type DigestData,
} from '@/lib/notifications/digest'
import {
  CLAIM_SHAPES,
  createMemberClient,
  createServiceClient,
  memberToken,
  preflight,
  type ClaimShape,
  type TestClient,
} from './local-stack'

// Isolation proof for the daily digest (migration 017). Extends the suite per
// CLAUDE.md rules 2 and 8 (never skip, weaken, or delete). Under test, all
// enforced at the database except the last group, which proves the composition
// itself cannot carry another org's data:
//
//   - SETTINGS ARE ADMIN ONLY: an admin updates digest_enabled and
//     digest_send_time through the migration 010 policy; a member reaches
//     neither, in either Clerk claim shape.
//   - THE LEDGER IS NOT A SETTING: no user session holds an insert or update
//     grant on digest_last_sent_on, the owning org's admin included. The
//     refusal is at the verb (42501), not a silently filtered row, because a
//     writable ledger would let a user replay today's digest or suppress
//     tomorrow's.
//   - THE SERVICE ROLE STAMPS IT, which is the cron path's write.
//   - CROSS ORG: a digest composed for org A contains nothing of org B, proven
//     by seeding both orgs with distinct incidents, tickets, and low stock and
//     asserting on the composed bodies themselves.

const runId = randomUUID()
const seed = {
  orgA: { clerk_org_id: `org_digest_a_${runId}`, name: 'Digest Test Org A' },
  orgB: { clerk_org_id: `org_digest_b_${runId}`, name: 'Digest Test Org B' },
  adminA: `user_digest_admin_a_${runId}`,
  memberA: `user_digest_member_a_${runId}`,
  adminB: `user_digest_admin_b_${runId}`,
}

// Distinct, unmistakable strings per org: if one appears in the other org's
// digest, the assertion names exactly what leaked.
const FIXTURES = {
  a: {
    monitor: 'Alpha Web Alpha',
    ticket: 'Alpha printer jam',
    item: 'Alpha toner',
  },
  b: {
    monitor: 'Bravo Web Bravo',
    ticket: 'Bravo laptop fault',
    item: 'Bravo keyboard',
  },
}

const BASE = 'https://talvex.example.com'

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

/**
 * Seeds one org with an open incident, a ticket the requester is waiting on,
 * and an item below its minimum: one row for every section the digest has.
 */
async function seedOrgContent(
  orgId: string,
  requester: string,
  fixture: { monitor: string; ticket: string; item: string },
): Promise<void> {
  const { data: monitor, error: monErr } = await service
    .from('monitors')
    .insert({ org_id: orgId, name: fixture.monitor, url: 'https://example.com' })
    .select('id')
    .single()
  if (monErr) throw new Error(`Seeding monitor failed: ${monErr.message}`)

  const { error: incErr } = await service.from('incidents').insert({
    org_id: orgId,
    monitor_id: monitor.id,
    status: 'open',
    opened_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
  })
  if (incErr) throw new Error(`Seeding incident failed: ${incErr.message}`)

  const { error: tickErr } = await service.from('tickets').insert({
    org_id: orgId,
    submitted_by: requester,
    title: fixture.ticket,
    description: 'Body content that must never reach an email.',
    created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  })
  if (tickErr) throw new Error(`Seeding ticket failed: ${tickErr.message}`)

  const { error: invErr } = await service.from('inventory_items').insert({
    org_id: orgId,
    name: fixture.item,
    quantity: 1,
    min_stock: 5,
    notes: 'Notes that must never reach an email.',
  })
  if (invErr) throw new Error(`Seeding inventory failed: ${invErr.message}`)
}

/**
 * Gathers and composes one org's digest exactly as the cron sweep does: the
 * same service role reads, the same helpers, the same composition. What this
 * asserts on is therefore the real email body.
 */
async function composeForOrg(orgId: string): Promise<string | null> {
  const nowMs = Date.now()

  const { data: incidents, error: incErr } = await service
    .from('incidents')
    .select('id, opened_at, monitors(name)')
    .eq('org_id', orgId)
    .eq('status', 'open')
    .order('opened_at', { ascending: true })
  if (incErr) throw new Error(incErr.message)

  const { data: tickets, error: tickErr } = await service
    .from('tickets')
    .select('id, title, submitted_by, created_at')
    .eq('org_id', orgId)
    .in('status', ['open', 'in_progress'])
  if (tickErr) throw new Error(tickErr.message)

  const ticketIds = tickets.map((t) => t.id)
  const { data: comments } = await service
    .from('ticket_comments')
    .select('ticket_id, author, created_at')
    .in('ticket_id', ticketIds.length > 0 ? ticketIds : ['none'])
  const { data: events } = await service
    .from('ticket_events')
    .select('ticket_id, occurred_at')
    .in('ticket_id', ticketIds.length > 0 ? ticketIds : ['none'])

  const awaiting = tickets
    .filter((t) =>
      isAwaitingReply(
        t.submitted_by,
        interleaveTrail(
          (comments ?? []).filter((c) => c.ticket_id === t.id),
          (events ?? []).filter((e) => e.ticket_id === t.id),
        ),
      ),
    )
    .map((t) => ({ ticketId: t.id, title: t.title, sinceIso: t.created_at }))

  const { data: inventory, error: invErr } = await service
    .from('inventory_items')
    .select('id, name, quantity, min_stock')
    .eq('org_id', orgId)
  if (invErr) throw new Error(invErr.message)

  const data: DigestData = {
    openIncidents: digestSection(
      incidents.map((i) => ({
        incidentId: i.id,
        monitorName: i.monitors?.name ?? 'Deleted monitor',
        openedAtIso: i.opened_at,
      })),
    ),
    expiringCertificates: digestSection([]),
    awaitingReply: digestSection(awaiting),
    newTickets: digestSection([]),
    lowStock: digestSection(
      inventory
        .filter((item) => isLowStock({ quantity: item.quantity, min_stock: item.min_stock }))
        .map((item) => ({
          itemId: item.id,
          name: item.name,
          quantity: item.quantity,
          minStock: item.min_stock,
        })),
    ),
  }

  return composeDigest(data, { baseUrl: BASE, nowMs })?.text ?? null
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
    { org_id: orgBId, clerk_user_id: seed.adminB, role: 'admin' },
  ])
  if (memberErr) throw new Error(`Seeding org_members failed: ${memberErr.message}`)

  // Settings rows seeded through each admin's OWN RLS session, proving admins
  // can create them. The token claim stays the default member, so the database
  // column (org_members.role) is what is being trusted.
  for (const [clerkOrgId, orgId, user] of [
    [seed.orgA.clerk_org_id, orgAId, seed.adminA],
    [seed.orgB.clerk_org_id, orgBId, seed.adminB],
  ] as const) {
    const { error } = await asUser(user, clerkOrgId, 'legacy')
      .from('org_notification_settings')
      .insert({
        org_id: orgId,
        notification_email: `ops-${orgId}@example.com`,
        digest_enabled: true,
        digest_send_time: '07:30',
      })
    if (error) {
      throw new Error(`Seeding settings as admin failed (admin policy?): ${error.message}`)
    }
  }

  await seedOrgContent(orgAId, seed.memberA, FIXTURES.a)
  await seedOrgContent(orgBId, seed.adminB, FIXTURES.b)

  seeded = true
}, 60_000)

afterAll(async () => {
  if (!seeded) return
  await service
    .from('organizations')
    .delete()
    .in('clerk_org_id', [seed.orgA.clerk_org_id, seed.orgB.clerk_org_id])
})

describe('admins manage the two digest settings', () => {
  it('an admin reads and updates digest_enabled and digest_send_time', async () => {
    const asAdminA = asUser(seed.adminA, seed.orgA.clerk_org_id, 'v2')

    const { data, error } = await asAdminA
      .from('org_notification_settings')
      .select('digest_enabled, digest_send_time')
    expect(error).toBeNull()
    expect(data).toEqual([{ digest_enabled: true, digest_send_time: '07:30:00' }])

    const { error: upErr } = await asAdminA
      .from('org_notification_settings')
      .update({ digest_enabled: false, digest_send_time: '06:15' })
      .eq('org_id', orgAId)
    expect(upErr).toBeNull()

    const { data: after } = await service
      .from('org_notification_settings')
      .select('digest_enabled, digest_send_time')
      .eq('org_id', orgAId)
      .single()
    expect(after!.digest_enabled).toBe(false)
    expect(after!.digest_send_time).toBe('06:15:00')

    // Put it back so later assertions read the seeded state.
    await service
      .from('org_notification_settings')
      .update({ digest_enabled: true, digest_send_time: '07:30' })
      .eq('org_id', orgAId)
  })

  it('the database refuses a send time carrying seconds', async () => {
    const { error } = await asUser(seed.adminA, seed.orgA.clerk_org_id, 'legacy')
      .from('org_notification_settings')
      .update({ digest_send_time: '07:30:30' })
      .eq('org_id', orgAId)
    expect(error).not.toBeNull()
  })
})

describe('digest_last_sent_on is the sweep ledger, not a setting', () => {
  it.each(CLAIM_SHAPES)(
    'no user session can write it, the owning org admin included (%s claim shape)',
    async (shape) => {
      const { data: before } = await service
        .from('org_notification_settings')
        .select('digest_last_sent_on')
        .eq('org_id', orgAId)
        .single()

      const { error } = await asUser(seed.adminA, seed.orgA.clerk_org_id, shape)
        .from('org_notification_settings')
        .update({ digest_last_sent_on: '2026-01-01' })
        .eq('org_id', orgAId)
      // Refused at the verb (42501): authenticated holds no update grant on
      // this column, so this is not a silently filtered row.
      expect(error).not.toBeNull()

      const { data: after } = await service
        .from('org_notification_settings')
        .select('digest_last_sent_on')
        .eq('org_id', orgAId)
        .single()
      expect(after!.digest_last_sent_on).toBe(before!.digest_last_sent_on)
    },
  )

  it('an admin cannot smuggle it in on the insert that creates the row', async () => {
    // A fresh org with no settings row yet: the first save is an INSERT, and
    // the insert grant excludes the ledger just as the update grant does.
    const clerkOrgId = `org_digest_c_${runId}`
    const { data: org, error: orgErr } = await service
      .from('organizations')
      .insert({ clerk_org_id: clerkOrgId, name: 'Digest Test Org C' })
      .select('id')
      .single()
    expect(orgErr).toBeNull()
    const adminC = `user_digest_admin_c_${runId}`
    await service
      .from('org_members')
      .insert({ org_id: org!.id, clerk_user_id: adminC, role: 'admin' })

    const { error } = await asUser(adminC, clerkOrgId, 'legacy')
      .from('org_notification_settings')
      .insert({
        org_id: org!.id,
        digest_enabled: true,
        digest_last_sent_on: '2030-01-01',
      })
    expect(error).not.toBeNull()

    await service.from('organizations').delete().eq('clerk_org_id', clerkOrgId)
  })

  it('the service role stamps it, as the cron path does', async () => {
    const { error } = await service
      .from('org_notification_settings')
      .update({ digest_last_sent_on: '2026-01-15' })
      .eq('org_id', orgAId)
    expect(error).toBeNull()

    const { data } = await service
      .from('org_notification_settings')
      .select('digest_last_sent_on')
      .eq('org_id', orgAId)
      .single()
    expect(data!.digest_last_sent_on).toBe('2026-01-15')

    await service
      .from('org_notification_settings')
      .update({ digest_last_sent_on: null })
      .eq('org_id', orgAId)
  })
})

describe.each(CLAIM_SHAPES)('members reach no digest setting (%s claim shape)', (shape) => {
  const asMemberA = () => asUser(seed.memberA, seed.orgA.clerk_org_id, shape)

  it('a member cannot select the digest settings', async () => {
    const { data, error } = await asMemberA()
      .from('org_notification_settings')
      .select('digest_enabled, digest_send_time')
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('a member cannot turn the digest on or move its time', async () => {
    await asMemberA()
      .from('org_notification_settings')
      .update({ digest_enabled: false, digest_send_time: '23:00' })
      .eq('org_id', orgAId)
    const { data } = await service
      .from('org_notification_settings')
      .select('digest_enabled, digest_send_time')
      .eq('org_id', orgAId)
      .single()
    expect(data!.digest_enabled).toBe(true)
    expect(data!.digest_send_time).toBe('07:30:00')
  })

  it('a member cannot write the ledger either', async () => {
    const { error } = await asMemberA()
      .from('org_notification_settings')
      .update({ digest_last_sent_on: '2026-01-01' })
      .eq('org_id', orgAId)
    expect(error).not.toBeNull()
  })

  it('an admin token CLAIM does not grant access when the column says member', async () => {
    const claimingAdmin = asUser(seed.memberA, seed.orgA.clerk_org_id, shape, 'admin')
    const { data } = await claimingAdmin
      .from('org_notification_settings')
      .select('digest_enabled')
    expect(data).toEqual([])
  })
})

describe.each(CLAIM_SHAPES)('cross org digest settings (%s claim shape)', (shape) => {
  it('org B admin cannot move org A digest time', async () => {
    await asUser(seed.adminB, seed.orgB.clerk_org_id, shape)
      .from('org_notification_settings')
      .update({ digest_send_time: '23:00' })
      .eq('org_id', orgAId)
    const { data } = await service
      .from('org_notification_settings')
      .select('digest_send_time')
      .eq('org_id', orgAId)
      .single()
    expect(data!.digest_send_time).toBe('07:30:00')
  })
})

describe('a composed digest carries one org and only one org', () => {
  it('org A digest names every A fixture and no B fixture', async () => {
    const body = await composeForOrg(orgAId)
    expect(body).not.toBeNull()
    for (const value of Object.values(FIXTURES.a)) {
      expect(body, `org A digest is missing ${value}`).toContain(value)
    }
    for (const value of Object.values(FIXTURES.b)) {
      expect(body, `org B data leaked into org A digest: ${value}`).not.toContain(value)
    }
  })

  it('org B digest names every B fixture and no A fixture', async () => {
    const body = await composeForOrg(orgBId)
    expect(body).not.toBeNull()
    for (const value of Object.values(FIXTURES.b)) {
      expect(body, `org B digest is missing ${value}`).toContain(value)
    }
    for (const value of Object.values(FIXTURES.a)) {
      expect(body, `org A data leaked into org B digest: ${value}`).not.toContain(value)
    }
  })

  it('carries no ticket description and no inventory notes', async () => {
    // Ruling 5 proved against real seeded rows, not just against fixtures:
    // both seeded records carry body text, and neither reaches the email.
    const body = await composeForOrg(orgAId)
    expect(body).not.toContain('must never reach an email')
  })

  it('an org with nothing to report composes to nothing at all', async () => {
    const clerkOrgId = `org_digest_quiet_${runId}`
    const { data: org } = await service
      .from('organizations')
      .insert({ clerk_org_id: clerkOrgId, name: 'Digest Test Org Quiet' })
      .select('id')
      .single()

    expect(await composeForOrg(org!.id)).toBeNull()

    await service.from('organizations').delete().eq('clerk_org_id', clerkOrgId)
  })
})
