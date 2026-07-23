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

// Isolation proof for incidents (Phase 1 Task 2), extending the suite per
// CLAUDE.md rules 2 and 8 (never skip, weaken, or delete).
//
// Incidents and incident_events are SERVICE ROLE ONLY writes: the cron
// sweep is the single writer, users only ever read. So beyond the usual
// cross tenant read and write probes, this file asserts that a member
// session cannot insert, update, or delete either table AT ALL, even
// inside its own organization. That is the grants (no insert/update/delete
// for authenticated) and the absent policies working together; the
// timeline's append only promise rests on it.
//
// Seeding writes incidents through the service client on purpose: it
// mirrors the production write path exactly.

const runId = randomUUID()

const seed = {
  orgA: { clerk_org_id: `org_inctest_a_${runId}`, name: 'Incident Test Org A' },
  orgB: { clerk_org_id: `org_inctest_b_${runId}`, name: 'Incident Test Org B' },
  userA: `user_inctest_a_${runId}`,
  userB: `user_inctest_b_${runId}`,
}

let service: TestClient
let orgAId: string
let orgBId: string
let monitorAId: string
let monitorBId: string
let incidentAOpenId: string
let incidentAResolvedId: string
let incidentBId: string
let eventAId: string
let seeded = false

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

  const { data: monitors, error: monErr } = await service
    .from('monitors')
    .insert([
      { org_id: orgAId, name: 'A site', url: 'https://a.example.com' },
      { org_id: orgBId, name: 'B site', url: 'https://b.example.com' },
    ])
    .select()
  if (monErr || monitors.length !== 2) {
    throw new Error(`Seeding monitors failed: ${monErr?.message}`)
  }
  monitorAId = monitors.find((m) => m.org_id === orgAId)!.id
  monitorBId = monitors.find((m) => m.org_id === orgBId)!.id

  // One open and one resolved incident for A, one open for B: enough shape
  // to probe every read and write from both sides. Written by the service
  // client, exactly like the cron path.
  const { data: incidents, error: incErr } = await service
    .from('incidents')
    .insert([
      {
        org_id: orgAId,
        monitor_id: monitorAId,
        status: 'open',
        opened_at: '2026-07-20T06:00:00Z',
      },
      {
        org_id: orgAId,
        monitor_id: monitorAId,
        status: 'resolved',
        opened_at: '2026-07-10T06:00:00Z',
        resolved_at: '2026-07-10T07:00:00Z',
      },
      {
        org_id: orgBId,
        monitor_id: monitorBId,
        status: 'open',
        opened_at: '2026-07-21T06:00:00Z',
      },
    ])
    .select()
  if (incErr || incidents.length !== 3) {
    throw new Error(`Seeding incidents failed: ${incErr?.message}`)
  }
  incidentAOpenId = incidents.find(
    (i) => i.org_id === orgAId && i.status === 'open',
  )!.id
  incidentAResolvedId = incidents.find(
    (i) => i.org_id === orgAId && i.status === 'resolved',
  )!.id
  incidentBId = incidents.find((i) => i.org_id === orgBId)!.id

  const { data: events, error: evErr } = await service
    .from('incident_events')
    .insert([
      {
        org_id: orgAId,
        incident_id: incidentAOpenId,
        event_type: 'opened',
        occurred_at: '2026-07-20T06:00:00Z',
        detail: 'Two checks in a row failed.',
      },
      {
        org_id: orgBId,
        incident_id: incidentBId,
        event_type: 'opened',
        occurred_at: '2026-07-21T06:00:00Z',
        detail: null,
      },
    ])
    .select()
  if (evErr || events.length !== 2) {
    throw new Error(`Seeding incident_events failed: ${evErr?.message}`)
  }
  eventAId = events.find((e) => e.org_id === orgAId)!.id

  seeded = true
}, 60_000)

afterAll(async () => {
  if (!seeded) return
  // FK cascades remove monitors, incidents, and events with the orgs.
  await service
    .from('organizations')
    .delete()
    .in('clerk_org_id', [seed.orgA.clerk_org_id, seed.orgB.clerk_org_id])
})

describe('control: the seed is visible without RLS', () => {
  // Guards the suite's validity: if seeding silently failed, every "B sees
  // nothing" assertion below would pass vacuously against empty tables.
  it('service role sees all three incidents and both events', async () => {
    const incidents = await service
      .from('incidents')
      .select('id')
      .in('id', [incidentAOpenId, incidentAResolvedId, incidentBId])
    expect(incidents.error).toBeNull()
    expect(incidents.data).toHaveLength(3)

    const events = await service
      .from('incident_events')
      .select('id')
      .in('incident_id', [incidentAOpenId, incidentBId])
    expect(events.error).toBeNull()
    expect(events.data).toHaveLength(2)
  })
})

describe.each(CLAIM_SHAPES)(
  "read isolation as org B's member (%s claim shape)",
  (shape) => {
    it("listing incidents returns B's and never A's", async () => {
      const { data, error } = await asMemberB(shape).from('incidents').select()
      expect(error).toBeNull()
      const ids = (data ?? []).map((i) => i.id)
      expect(ids).toContain(incidentBId)
      expect(ids).not.toContain(incidentAOpenId)
      expect(ids).not.toContain(incidentAResolvedId)
    })

    it("direct select of A's incident by id returns empty, not an error", async () => {
      const { data, error } = await asMemberB(shape)
        .from('incidents')
        .select()
        .eq('id', incidentAOpenId)
      expect(error).toBeNull()
      expect(data).toEqual([])
    })

    it("A's timeline is invisible, by event id, incident id, and org id", async () => {
      const byId = await asMemberB(shape)
        .from('incident_events')
        .select()
        .eq('id', eventAId)
      expect(byId.error).toBeNull()
      expect(byId.data).toEqual([])

      const byIncident = await asMemberB(shape)
        .from('incident_events')
        .select()
        .eq('incident_id', incidentAOpenId)
      expect(byIncident.error).toBeNull()
      expect(byIncident.data).toEqual([])

      const byOrg = await asMemberB(shape)
        .from('incident_events')
        .select()
        .eq('org_id', orgAId)
      expect(byOrg.error).toBeNull()
      expect(byOrg.data).toEqual([])

      // And the unfiltered list carries only B's rows.
      const all = await asMemberB(shape).from('incident_events').select()
      expect(all.error).toBeNull()
      expect((all.data ?? []).map((e) => e.org_id)).toEqual([orgBId])
    })
  },
)

describe.each(CLAIM_SHAPES)(
  "write isolation as org B's member (%s claim shape)",
  (shape) => {
    it("cannot insert an incident carrying A's ids, and state is unchanged", async () => {
      const { error } = await asMemberB(shape).from('incidents').insert({
        org_id: orgAId,
        monitor_id: monitorAId,
        status: 'open',
        opened_at: '2026-07-22T00:00:00Z',
      })
      expect(error).not.toBeNull()

      const { data: planted } = await service
        .from('incidents')
        .select('id')
        .eq('org_id', orgAId)
      expect(planted).toHaveLength(2) // exactly the two seeded, nothing new
    })

    it("cannot insert a timeline event onto A's incident, and the timeline is unchanged", async () => {
      const { error } = await asMemberB(shape).from('incident_events').insert({
        org_id: orgAId,
        incident_id: incidentAOpenId,
        event_type: 'resolved',
        occurred_at: '2026-07-22T00:00:00Z',
        detail: 'forged',
      })
      expect(error).not.toBeNull()

      const { data: timeline } = await service
        .from('incident_events')
        .select('event_type')
        .eq('incident_id', incidentAOpenId)
      expect(timeline).toEqual([{ event_type: 'opened' }])
    })

    it("cannot update A's incident, and it stays open", async () => {
      const { error } = await asMemberB(shape)
        .from('incidents')
        .update({ status: 'resolved', resolved_at: '2026-07-22T00:00:00Z' })
        .eq('id', incidentAOpenId)
      expect(error).not.toBeNull() // no update grant at all: permission denied

      const { data: intact } = await service
        .from('incidents')
        .select('status, resolved_at')
        .eq('id', incidentAOpenId)
        .single()
      expect(intact).toEqual({ status: 'open', resolved_at: null })
    })

    it('cannot write incidents even in its OWN org: the cron path is the only writer', async () => {
      const insert = await asMemberB(shape).from('incidents').insert({
        org_id: orgBId,
        monitor_id: monitorBId,
        status: 'resolved',
        opened_at: '2026-07-01T00:00:00Z',
        resolved_at: '2026-07-01T01:00:00Z',
      })
      expect(insert.error).not.toBeNull()

      const update = await asMemberB(shape)
        .from('incidents')
        .update({ status: 'resolved', resolved_at: '2026-07-22T00:00:00Z' })
        .eq('id', incidentBId)
      expect(update.error).not.toBeNull()

      const del = await asMemberB(shape)
        .from('incidents')
        .delete()
        .eq('id', incidentBId)
      expect(del.error).not.toBeNull()

      const { data: intact } = await service
        .from('incidents')
        .select('id, status')
        .eq('org_id', orgBId)
      expect(intact).toEqual([{ id: incidentBId, status: 'open' }])
    })

    it('cannot touch its OWN timeline either: append only means no user writes at all', async () => {
      const insert = await asMemberB(shape).from('incident_events').insert({
        org_id: orgBId,
        incident_id: incidentBId,
        event_type: 'resolved',
        occurred_at: '2026-07-22T00:00:00Z',
        detail: 'user written',
      })
      expect(insert.error).not.toBeNull()

      const update = await asMemberB(shape)
        .from('incident_events')
        .update({ detail: 'edited history' })
        .eq('incident_id', incidentBId)
      expect(update.error).not.toBeNull()

      const del = await asMemberB(shape)
        .from('incident_events')
        .delete()
        .eq('incident_id', incidentBId)
      expect(del.error).not.toBeNull()

      const { data: timeline } = await service
        .from('incident_events')
        .select('event_type, detail')
        .eq('incident_id', incidentBId)
      expect(timeline).toEqual([{ event_type: 'opened', detail: null }])
    })
  },
)

describe('a session with no active organization', () => {
  it('sees zero rows in both incident tables, without error', async () => {
    const orgless = createMemberClient(orglessToken(seed.userA))

    for (const table of ['incidents', 'incident_events'] as const) {
      const { data, error } = await orgless.from(table).select()
      expect(error, `${table} select should not error`).toBeNull()
      expect(data, `${table} must be empty for an org-less session`).toEqual([])
    }
  })

  it('cannot write either table', async () => {
    const orgless = createMemberClient(orglessToken(seed.userA))

    const incident = await orgless.from('incidents').insert({
      org_id: orgAId,
      monitor_id: monitorAId,
      status: 'open',
      opened_at: '2026-07-22T00:00:00Z',
    })
    expect(incident.error).not.toBeNull()

    const event = await orgless.from('incident_events').insert({
      org_id: orgAId,
      incident_id: incidentAOpenId,
      event_type: 'resolved',
      occurred_at: '2026-07-22T00:00:00Z',
    })
    expect(event.error).not.toBeNull()
  })
})
