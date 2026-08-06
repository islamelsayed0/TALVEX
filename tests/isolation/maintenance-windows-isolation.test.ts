import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  CLAIM_SHAPES,
  createMemberClient,
  createServiceClient,
  memberToken,
  preflight,
  type TestClient,
} from './local-stack'

// Isolation proof for maintenance windows (migration 021). The columns ride
// the existing monitors policies for rows, so cross org isolation is
// inherited; what THIS file proves is the part RLS cannot say: only an org
// admin session may pause or resume (the BEFORE UPDATE gate raises for
// members), the 24 hour cap holds against the stamped set time, the stamp
// itself is unreachable from any user session, and both audit actions land
// exactly once per admin action through the 013 definer pattern.

const runId = randomUUID()

const seed = {
  orgA: { clerk_org_id: `org_mw_a_${runId}`, name: 'Windows Org A' },
  orgB: { clerk_org_id: `org_mw_b_${runId}`, name: 'Windows Org B' },
  adminA: `user_mw_admin_a_${runId}`,
  memberA: `user_mw_member_a_${runId}`,
  adminB: `user_mw_admin_b_${runId}`,
}

let service: TestClient
let orgAId: string
let orgBId: string
/** One org A monitor per claim shape, so audit counts stay per case. */
const monitorAByShape = new Map<string, string>()
let monitorBId: string
let seeded = false

const asAdminA = (shape: (typeof CLAIM_SHAPES)[number]) =>
  createMemberClient(
    memberToken({
      clerkUserId: seed.adminA,
      clerkOrgId: seed.orgA.clerk_org_id,
      shape,
      claimRole: 'admin',
    }),
  )

const asMemberA = (shape: (typeof CLAIM_SHAPES)[number]) =>
  createMemberClient(
    memberToken({
      clerkUserId: seed.memberA,
      clerkOrgId: seed.orgA.clerk_org_id,
      shape,
      claimRole: 'member',
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
    { org_id: orgAId, clerk_user_id: seed.memberA, role: 'member' },
    { org_id: orgBId, clerk_user_id: seed.adminB, role: 'admin' },
  ])
  if (memberErr) throw new Error(`Seeding org_members failed: ${memberErr.message}`)

  const { data: monitors, error: monErr } = await service
    .from('monitors')
    .insert([
      { org_id: orgAId, name: `A legacy ${runId}`, url: 'https://a-legacy.example.com' },
      { org_id: orgAId, name: `A v2 ${runId}`, url: 'https://a-v2.example.com' },
      { org_id: orgBId, name: `B one ${runId}`, url: 'https://b-one.example.com' },
    ])
    .select()
  if (monErr || monitors.length !== 3) {
    throw new Error(`Seeding monitors failed: ${monErr?.message}`)
  }
  monitorAByShape.set('legacy', monitors.find((m) => m.name.startsWith('A legacy'))!.id)
  monitorAByShape.set('v2', monitors.find((m) => m.name.startsWith('A v2'))!.id)
  monitorBId = monitors.find((m) => m.name.startsWith('B one'))!.id

  seeded = true
}, 60_000)

afterAll(async () => {
  if (!seeded) return
  await service
    .from('organizations')
    .delete()
    .in('clerk_org_id', [seed.orgA.clerk_org_id, seed.orgB.clerk_org_id])
})

function hoursFromNow(h: number): string {
  return new Date(Date.now() + h * 60 * 60 * 1000).toISOString()
}

describe.each(CLAIM_SHAPES)('maintenance windows (%s claim shape)', (shape) => {
  it('a member cannot pause or resume, even on their own org monitor', async () => {
    const monitorId = monitorAByShape.get(shape)!
    const pause = await asMemberA(shape)
      .from('monitors')
      .update({ suppress_until: hoursFromNow(1) })
      .eq('id', monitorId)
    expect(pause.error).not.toBeNull()
    expect(pause.error!.code).toBe('42501')

    // Clearing is gated exactly the same: a member cannot end a window an
    // admin set. First plant one through the service role to clear against.
    await service
      .from('monitors')
      .update({ suppress_until: hoursFromNow(1) })
      .eq('id', monitorId)
    const resume = await asMemberA(shape)
      .from('monitors')
      .update({ suppress_until: null })
      .eq('id', monitorId)
    expect(resume.error).not.toBeNull()
    expect(resume.error!.code).toBe('42501')
    await service.from('monitors').update({ suppress_until: null }).eq('id', monitorId)
  })

  it('no user session can write the stamped set time at all', async () => {
    const monitorId = monitorAByShape.get(shape)!
    const { error } = await asAdminA(shape)
      .from('monitors')
      .update({ suppress_set_at: hoursFromNow(-1) })
      .eq('id', monitorId)
    expect(error).not.toBeNull()
    expect(error!.code).toBe('42501')
  })

  it('an admin pauses, the stamp lands, and exactly one audit row records it', async () => {
    const monitorId = monitorAByShape.get(shape)!
    const until = hoursFromNow(4)
    const { data, error } = await asAdminA(shape)
      .from('monitors')
      .update({ suppress_until: until })
      .eq('id', monitorId)
      .select('suppress_until')
      .single()
    expect(error).toBeNull()
    expect(Date.parse(data!.suppress_until!)).toBe(Date.parse(until))

    // The stamp came from the gate trigger, not the client, and it is now.
    const { data: stamped } = await service
      .from('monitors')
      .select('suppress_set_at, name')
      .eq('id', monitorId)
      .single()
    expect(stamped!.suppress_set_at).not.toBeNull()
    expect(
      Math.abs(Date.now() - Date.parse(stamped!.suppress_set_at!)),
    ).toBeLessThan(60_000)

    // Filtered by actor: the service role plants earlier in this file audit
    // too (actor NULL, the system), and the claim here is that THIS admin
    // action produced exactly one row.
    const { data: auditRows } = await service
      .from('audit_log')
      .select('action, actor, detail')
      .eq('org_id', orgAId)
      .eq('action', 'monitor_alerts_paused')
      .eq('detail->>name', stamped!.name)
      .eq('actor', seed.adminA)
    expect(auditRows).toHaveLength(1)
    expect(
      Date.parse((auditRows![0].detail as { until: string }).until),
    ).toBe(Date.parse(until))
  })

  it('an admin resumes, the stamp clears, and exactly one audit row records it', async () => {
    const monitorId = monitorAByShape.get(shape)!
    const { error } = await asAdminA(shape)
      .from('monitors')
      .update({ suppress_until: null })
      .eq('id', monitorId)
    expect(error).toBeNull()

    const { data: cleared } = await service
      .from('monitors')
      .select('suppress_until, suppress_set_at, name')
      .eq('id', monitorId)
      .single()
    expect(cleared!.suppress_until).toBeNull()
    expect(cleared!.suppress_set_at).toBeNull()

    const { data: auditRows } = await service
      .from('audit_log')
      .select('action, actor')
      .eq('org_id', orgAId)
      .eq('action', 'monitor_alerts_resumed')
      .eq('detail->>name', cleared!.name)
      .eq('actor', seed.adminA)
    expect(auditRows).toHaveLength(1)
  })

  it("an org A admin cannot touch org B's window", async () => {
    const { data, error } = await asAdminA(shape)
      .from('monitors')
      .update({ suppress_until: hoursFromNow(1) })
      .eq('id', monitorBId)
      .select()
    // Filtered by RLS, not raised: zero rows matched, nothing changed.
    expect(error).toBeNull()
    expect(data).toEqual([])

    const { data: intact } = await service
      .from('monitors')
      .select('suppress_until')
      .eq('id', monitorBId)
      .single()
    expect(intact!.suppress_until).toBeNull()
  })

  it('the database refuses a window past the 24 hour cap, admin or not', async () => {
    const monitorId = monitorAByShape.get(shape)!
    const { error } = await asAdminA(shape)
      .from('monitors')
      .update({ suppress_until: hoursFromNow(25) })
      .eq('id', monitorId)
    expect(error).not.toBeNull()
    expect(error!.code).toBe('23514')

    const { data: untouched } = await service
      .from('monitors')
      .select('suppress_until')
      .eq('id', monitorId)
      .single()
    expect(untouched!.suppress_until).toBeNull()
  })
})

describe('the service role path', () => {
  it('can set and clear windows, for the sweep and for seeding', async () => {
    const monitorId = monitorAByShape.get('legacy')!
    const until = hoursFromNow(2)
    const set = await service
      .from('monitors')
      .update({ suppress_until: until })
      .eq('id', monitorId)
      .select('suppress_until, suppress_set_at')
      .single()
    expect(set.error).toBeNull()
    expect(set.data!.suppress_set_at).not.toBeNull()

    const clear = await service
      .from('monitors')
      .update({ suppress_until: null })
      .eq('id', monitorId)
      .select('suppress_set_at')
      .single()
    expect(clear.error).toBeNull()
    expect(clear.data!.suppress_set_at).toBeNull()
  })
})
