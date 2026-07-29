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

/**
 * The public status page (migration 011) is the first anonymous read surface.
 * These tests are the point of the feature: prove at the database that anon
 * reads exactly the opted-in orgs' narrow columns and nothing else, holds no
 * write verb, and that authenticated behavior is unchanged. The database is the
 * boundary, so a bug in app code cannot leak a private org or a monitor url.
 */

const runId = randomUUID()
const slug = `status-${runId.slice(0, 8)}`
const seed = {
  orgIn: { clerk_org_id: `org_sp_in_${runId}`, name: 'Status Public Org' },
  orgOut: { clerk_org_id: `org_sp_out_${runId}`, name: 'Status Private Org' },
  admin: `user_sp_admin_${runId}`,
  member: `user_sp_member_${runId}`,
}

let service: TestClient
let orgInId: string
let orgOutId: string
let monitorInId: string
let monitorOutId: string
let seeded = false

beforeAll(async () => {
  await preflight()
  service = createServiceClient()

  // One org opted in (enabled + slug), one private (disabled by default).
  const { data: orgs, error: orgErr } = await service
    .from('organizations')
    .insert([
      { ...seed.orgIn, status_page_enabled: true, status_page_slug: slug },
      { ...seed.orgOut, status_page_enabled: false, status_page_slug: null },
    ])
    .select()
  if (orgErr || !orgs || orgs.length !== 2) {
    throw new Error(`seed orgs failed: ${orgErr?.message}`)
  }
  orgInId = orgs.find((o) => o.clerk_org_id === seed.orgIn.clerk_org_id)!.id
  orgOutId = orgs.find((o) => o.clerk_org_id === seed.orgOut.clerk_org_id)!.id

  const { error: memErr } = await service.from('org_members').insert([
    { org_id: orgInId, clerk_user_id: seed.admin, role: 'admin' },
    { org_id: orgInId, clerk_user_id: seed.member, role: 'member' },
  ])
  if (memErr) throw new Error(`seed members failed: ${memErr.message}`)

  const { data: mons, error: monErr } = await service
    .from('monitors')
    .insert([
      {
        org_id: orgInId,
        name: 'Public Monitor',
        url: 'https://public.example.com',
        last_status: 'up',
      },
      {
        org_id: orgOutId,
        name: 'Private Monitor',
        url: 'https://private.example.com',
        last_status: 'down',
      },
    ])
    .select()
  if (monErr || !mons) throw new Error(`seed monitors failed: ${monErr?.message}`)
  monitorInId = mons.find((m) => m.org_id === orgInId)!.id
  monitorOutId = mons.find((m) => m.org_id === orgOutId)!.id

  const { error: rollErr } = await service.from('monitor_daily_rollups').insert([
    { monitor_id: monitorInId, org_id: orgInId, day: '2026-07-27', uptime_percent: 99.5, check_count: 288 },
    { monitor_id: monitorOutId, org_id: orgOutId, day: '2026-07-27', uptime_percent: 80.0, check_count: 288 },
  ])
  if (rollErr) throw new Error(`seed rollups failed: ${rollErr.message}`)

  const { error: incErr } = await service.from('incidents').insert([
    { org_id: orgInId, monitor_id: monitorInId, status: 'resolved', opened_at: '2026-07-27T10:00:00Z', resolved_at: '2026-07-27T10:30:00Z' },
    { org_id: orgOutId, monitor_id: monitorOutId, status: 'open', opened_at: '2026-07-27T11:00:00Z' },
  ])
  if (incErr) throw new Error(`seed incidents failed: ${incErr.message}`)

  seeded = true
}, 60_000)

afterAll(async () => {
  if (!seeded) return
  await service
    .from('organizations')
    .delete()
    .in('clerk_org_id', [seed.orgIn.clerk_org_id, seed.orgOut.clerk_org_id])
})

describe('control: the seed is visible via the service role', () => {
  it('both orgs and their monitors exist', async () => {
    const { data } = await service.from('monitors').select('id').in('org_id', [orgInId, orgOutId])
    expect(data?.length).toBe(2)
  })
})

describe('anon reads a public status page, and only for opted-in orgs', () => {
  it('reads the enabled org row: id, name, slug', async () => {
    const { data, error } = await createAnonClient()
      .from('organizations')
      .select('id, name, status_page_slug')
      .eq('id', orgInId)
    expect(error).toBeNull()
    expect(data).toEqual([{ id: orgInId, name: seed.orgIn.name, status_page_slug: slug }])
  })

  it('cannot see the disabled org (empty, no error)', async () => {
    const { data, error } = await createAnonClient()
      .from('organizations')
      .select('id, name, status_page_slug')
      .eq('id', orgOutId)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('reads the enabled org monitors: name and status', async () => {
    const { data, error } = await createAnonClient()
      .from('monitors')
      .select('id, name, last_status')
      .eq('org_id', orgInId)
    expect(error).toBeNull()
    expect(data).toEqual([{ id: monitorInId, name: 'Public Monitor', last_status: 'up' }])
  })

  it('sees no monitors, rollups, or incidents for a disabled org', async () => {
    const anon = createAnonClient()
    const mon = await anon.from('monitors').select('id').eq('org_id', orgOutId)
    expect(mon.error).toBeNull()
    expect(mon.data).toEqual([])
    const roll = await anon.from('monitor_daily_rollups').select('day').eq('org_id', orgOutId)
    expect(roll.error).toBeNull()
    expect(roll.data).toEqual([])
    const inc = await anon.from('incidents').select('id').eq('org_id', orgOutId)
    expect(inc.error).toBeNull()
    expect(inc.data).toEqual([])
  })

  it('reads rollups and incidents for the enabled org', async () => {
    const anon = createAnonClient()
    const roll = await anon.from('monitor_daily_rollups').select('day, uptime_percent').eq('org_id', orgInId)
    expect(roll.error).toBeNull()
    expect(roll.data?.length).toBe(1)
    const inc = await anon.from('incidents').select('status, opened_at, resolved_at').eq('org_id', orgInId)
    expect(inc.error).toBeNull()
    expect(inc.data?.length).toBe(1)
  })
})

describe('anon can never read excluded columns, even on an enabled org', () => {
  it('is refused monitors.url (42501)', async () => {
    const { error } = await createAnonClient().from('monitors').select('url').eq('org_id', orgInId)
    expect(error).not.toBeNull()
    expect(`${error?.code} ${error?.message}`).toMatch(/42501|permission denied/i)
  })

  it('is refused monitors.interval_seconds config (42501)', async () => {
    const { error } = await createAnonClient().from('monitors').select('interval_seconds').eq('org_id', orgInId)
    expect(error).not.toBeNull()
    expect(`${error?.code} ${error?.message}`).toMatch(/42501|permission denied/i)
  })

  it('is refused organizations.clerk_org_id (42501)', async () => {
    const { error } = await createAnonClient().from('organizations').select('clerk_org_id').eq('id', orgInId)
    expect(error).not.toBeNull()
    expect(`${error?.code} ${error?.message}`).toMatch(/42501|permission denied/i)
  })
})

describe('anon holds no write verb on any of the four tables', () => {
  it('cannot insert a monitor', async () => {
    const { error } = await createAnonClient()
      .from('monitors')
      .insert({ org_id: orgInId, name: 'x', url: 'https://x.example.com' })
    expect(error).not.toBeNull()
  })

  it('cannot flip an org status flag, and nothing changes', async () => {
    const { error } = await createAnonClient()
      .from('organizations')
      .update({ status_page_enabled: false })
      .eq('id', orgInId)
    expect(error).not.toBeNull()
    const { data } = await service.from('organizations').select('status_page_enabled').eq('id', orgInId).single()
    expect(data?.status_page_enabled).toBe(true)
  })

  it('cannot delete an incident', async () => {
    const { error } = await createAnonClient().from('incidents').delete().eq('org_id', orgInId)
    expect(error).not.toBeNull()
  })
})

describe('authenticated behavior on these tables is unchanged', () => {
  it('a member still reads their own org monitors, url included', async () => {
    const asMember = createMemberClient(
      memberToken({ clerkUserId: seed.member, clerkOrgId: seed.orgIn.clerk_org_id, shape: 'legacy' }),
    )
    const { data, error } = await asMember.from('monitors').select('id, url').eq('org_id', orgInId)
    expect(error).toBeNull()
    expect(data?.[0]?.url).toBe('https://public.example.com')
  })
})

describe('admin write policy for the status page', () => {
  it('an admin can set the slug on their own org', async () => {
    const asAdmin = createMemberClient(
      memberToken({ clerkUserId: seed.admin, clerkOrgId: seed.orgIn.clerk_org_id, shape: 'legacy', claimRole: 'admin' }),
    )
    const newSlug = `admincheck-${runId.slice(0, 8)}`
    const { error } = await asAdmin.from('organizations').update({ status_page_slug: newSlug }).eq('id', orgInId)
    expect(error).toBeNull()
    const { data } = await service.from('organizations').select('status_page_slug').eq('id', orgInId).single()
    expect(data?.status_page_slug).toBe(newSlug)
  })

  it('a member cannot, even with an admin token claim (the column is authoritative)', async () => {
    const asMemberAdminClaim = createMemberClient(
      memberToken({ clerkUserId: seed.member, clerkOrgId: seed.orgIn.clerk_org_id, shape: 'legacy', claimRole: 'admin' }),
    )
    const { data, error } = await asMemberAdminClaim
      .from('organizations')
      .update({ status_page_enabled: false })
      .eq('id', orgInId)
      .select()
    expect(error).toBeNull()
    expect(data).toEqual([])
  })
})
