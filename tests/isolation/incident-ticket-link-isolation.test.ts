import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  CLAIM_SHAPES,
  createMemberClient,
  createServiceClient,
  memberToken,
  orglessToken,
  preflight,
  type ClaimShape,
  type TestClient,
} from './local-stack'

// Isolation proof for the incident to ticket bridge (Phase 1 Task 4),
// extending the suite per CLAUDE.md rules 2 and 8 (never skip, weaken, or
// delete). The bridge adds exactly one new attack surface: tickets.incident_id.
// The rules under test, all enforced by RLS and the column grants at the
// database:
//   - THE NEW BOUNDARY: a ticket may carry an incident_id only when that
//     incident belongs to the SAME org. Org B cannot mint a ticket pointing
//     at org A's incident; the insert with check refuses it, and A is left
//     unchanged.
//   - A member cannot link to an incident they cannot see, even one in another
//     org they are not in: same refusal, from the same clause.
//   - THE MEMBER LINKING DECISION (Task 4 ruling, allow): a plain member, not
//     only an admin, may create a ticket linked to an incident in their own
//     org. The link is harmless same org metadata; the button being admin only
//     is a UI concern, not a database one. Proven by seeding the linked ticket
//     through a MEMBER's own RLS session.
//   - The link is fixed at birth: incident_id is not in the update grant, so
//     nobody can rewrite it later, not even an admin.
//   - The trail records origin: a ticket born linked gets a
//     created_from_incident event carrying the incident id in its detail.
//   - Cross org read: org B sees nothing of the linkage in either direction.
//
// The link is seeded through the real production write path (a member client
// under RLS), so seeding itself proves the allow decision and the with check.

const runId = randomUUID()

const seed = {
  orgA: { clerk_org_id: `org_link_a_${runId}`, name: 'Link Test Org A' },
  orgB: { clerk_org_id: `org_link_b_${runId}`, name: 'Link Test Org B' },
  /** Org A, plain member (role member). Creates the linked ticket. */
  memberA: `user_link_a_${runId}`,
  /** Org A, admin. Used to prove incident_id is immutable even for admins. */
  adminA: `user_link_admin_${runId}`,
  /** Org B, plain member. Must never link to, or see, anything of A. */
  memberB: `user_link_b_${runId}`,
}

let service: TestClient
let orgAId: string
let orgBId: string
let incidentAId: string
let incidentBId: string
let linkedTicketAId: string
let seeded = false

const asUser = (clerkUserId: string, clerkOrgId: string, shape: ClaimShape) =>
  createMemberClient(memberToken({ clerkUserId, clerkOrgId, shape }))

const asMemberA = (shape: ClaimShape) =>
  asUser(seed.memberA, seed.orgA.clerk_org_id, shape)
const asMemberB = (shape: ClaimShape) =>
  asUser(seed.memberB, seed.orgB.clerk_org_id, shape)

async function seedIncident(orgId: string): Promise<string> {
  // Incidents are service role written in production (the cron sweep), so
  // seeding them with the service client mirrors reality. A throwaway monitor
  // gives the incident its required monitor_id.
  const { data: monitor, error: mErr } = await service
    .from('monitors')
    .insert({ org_id: orgId, name: 'Link test monitor', url: 'https://example.com' })
    .select()
    .single()
  if (mErr || !monitor) throw new Error(`Seeding monitor failed: ${mErr?.message}`)

  const { data: incident, error: iErr } = await service
    .from('incidents')
    .insert({
      org_id: orgId,
      monitor_id: monitor.id,
      status: 'open',
      opened_at: new Date().toISOString(),
    })
    .select()
    .single()
  if (iErr || !incident) throw new Error(`Seeding incident failed: ${iErr?.message}`)
  return incident.id
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
    { org_id: orgAId, clerk_user_id: seed.memberA, role: 'member' },
    { org_id: orgAId, clerk_user_id: seed.adminA, role: 'admin' },
    { org_id: orgBId, clerk_user_id: seed.memberB, role: 'member' },
  ])
  if (memberErr) throw new Error(`Seeding org_members failed: ${memberErr.message}`)

  incidentAId = await seedIncident(orgAId)
  incidentBId = await seedIncident(orgBId)

  // The allow decision, exercised as the seed: a PLAIN MEMBER of org A creates
  // a ticket linked to A's own incident, through their own RLS session. If the
  // with check gated linking to admins, this insert would fail and the whole
  // suite would fail loudly at seeding.
  const { data: ticket, error: tErr } = await asMemberA('legacy')
    .from('tickets')
    .insert({
      org_id: orgAId,
      submitted_by: seed.memberA,
      title: 'Outage: Link test monitor',
      description: 'Created from the incident, by a member.',
      incident_id: incidentAId,
    })
    .select()
    .single()
  if (tErr || !ticket) {
    throw new Error(`Seeding linked ticket failed (allow decision?): ${tErr?.message}`)
  }
  linkedTicketAId = ticket.id

  seeded = true
}, 60_000)

afterAll(async () => {
  if (!seeded) return
  // FK cascades remove monitors, incidents, tickets, and their trail with the
  // orgs. tickets.incident_id is ON DELETE SET NULL, but the ticket rows go
  // anyway when their org cascades.
  await service
    .from('organizations')
    .delete()
    .in('clerk_org_id', [seed.orgA.clerk_org_id, seed.orgB.clerk_org_id])
})

describe('control: the seed proves the allow decision and the trail', () => {
  it('a member created the linked ticket, and incident_id points at A', async () => {
    const { data, error } = await service
      .from('tickets')
      .select('submitted_by, incident_id, status')
      .eq('id', linkedTicketAId)
      .single()
    expect(error).toBeNull()
    expect(data).toEqual({
      submitted_by: seed.memberA,
      incident_id: incidentAId,
      status: 'open',
    })
  })

  it('the trail records created_from_incident, carrying the incident id in detail', async () => {
    const { data, error } = await service
      .from('ticket_events')
      .select('event_type, actor, detail')
      .eq('ticket_id', linkedTicketAId)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data![0].event_type).toBe('created_from_incident')
    expect(data![0].actor).toBe(seed.memberA)
    // The id itself rides in the detail, per the ruling.
    expect(data![0].detail).toContain(incidentAId)
  })
})

describe.each(CLAIM_SHAPES)(
  'the new boundary, as org B (%s claim shape)',
  (shape) => {
    it("org B cannot create a ticket linked to A's incident; A is unchanged", async () => {
      const { error } = await asMemberB(shape).from('tickets').insert({
        org_id: orgBId, // B's own org, so only the incident_id is out of bounds
        submitted_by: seed.memberB,
        title: 'stealing an incident',
        description: 'links to another org incident, must be refused',
        incident_id: incidentAId,
      })
      expect(error).not.toBeNull()

      // Nothing in B references A's incident, and A's only linked ticket is
      // still the one member A seeded.
      const { data: bLinked } = await service
        .from('tickets')
        .select('id')
        .eq('incident_id', incidentAId)
      expect(bLinked).toEqual([{ id: linkedTicketAId }])
    })

    it("org B cannot see A's linked ticket, by list or by direct id", async () => {
      const list = await asMemberB(shape).from('tickets').select('id')
      expect(list.error).toBeNull()
      expect((list.data ?? []).map((t) => t.id)).not.toContain(linkedTicketAId)

      const direct = await asMemberB(shape)
        .from('tickets')
        .select()
        .eq('id', linkedTicketAId)
      expect(direct.error).toBeNull()
      expect(direct.data).toEqual([])
    })
  },
)

describe.each(CLAIM_SHAPES)(
  'linking is confined to visible incidents (%s claim shape)',
  (shape) => {
    it("a member of A cannot link a ticket to B's incident (they cannot see it)", async () => {
      const { error } = await asMemberA(shape).from('tickets').insert({
        org_id: orgAId,
        submitted_by: seed.memberA,
        title: 'reaching into B',
        description: "links to B's incident, must be refused",
        incident_id: incidentBId,
      })
      expect(error).not.toBeNull()

      const { data: bIncidentLinks } = await service
        .from('tickets')
        .select('id')
        .eq('incident_id', incidentBId)
      expect(bIncidentLinks).toEqual([])
    })

    it('an ordinary unlinked ticket still creates fine (the clause only bites on a link)', async () => {
      const { data, error } = await asMemberA(shape).from('tickets').insert({
        org_id: orgAId,
        submitted_by: seed.memberA,
        title: 'ordinary request',
        description: 'no incident_id, should be born open and unlinked',
      })
        .select('incident_id, status')
        .single()
      expect(error).toBeNull()
      expect(data).toEqual({ incident_id: null, status: 'open' })
    })
  },
)

describe('the link is fixed at birth', () => {
  it('incident_id is not in the update grant: not even an admin can rewrite it', async () => {
    const asAdminA = createMemberClient(
      memberToken({
        clerkUserId: seed.adminA,
        clerkOrgId: seed.orgA.clerk_org_id,
        shape: 'v2',
      }),
    )
    const { error } = await asAdminA
      .from('tickets')
      .update({ incident_id: incidentBId })
      .eq('id', linkedTicketAId)
    expect(error).not.toBeNull() // permission denied at the column grant

    const { data: intact } = await service
      .from('tickets')
      .select('incident_id')
      .eq('id', linkedTicketAId)
      .single()
    expect(intact).toEqual({ incident_id: incidentAId })
  })
})

describe('a session with no active organization', () => {
  it('cannot create a linked ticket', async () => {
    const orgless = createMemberClient(orglessToken(seed.memberA))
    const { error } = await orgless.from('tickets').insert({
      org_id: orgAId,
      submitted_by: seed.memberA,
      title: 'orgless link',
      description: 'must be refused',
      incident_id: incidentAId,
    })
    expect(error).not.toBeNull()
  })
})
