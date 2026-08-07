import { getEntitlements } from '@/lib/billing/entitlements'
import { createOrgScopedClient } from './client'
import { validateMonitorUrl } from './monitor-url'
import type { Monitor, MonitorCheck } from './types'

/**
 * Typed data layer for uptime monitors (CLAUDE.md code rule 7: components
 * never call .from() themselves). Everything here runs on the org scoped
 * client, so RLS has filtered rows before any code in this file sees them;
 * explicit .eq() filters are defense in depth and better query plans, not
 * the isolation mechanism. The cron sweep does NOT use this module; it runs
 * on the service role client inside its own route.
 */

/** User input failed validation; message is safe to show as form feedback. */
export class MonitorValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MonitorValidationError'
  }
}

/**
 * The Clerk webhook has not synced the active org into Postgres yet, so
 * there is no org row to attach the monitor to. Transient right after org
 * creation; resolves as soon as the webhook delivers.
 */
export class OrgNotSyncedError extends Error {
  constructor() {
    super('This organization is still being set up. Try again in a moment.')
    this.name = 'OrgNotSyncedError'
  }
}

export type MonitorInput = {
  name: string
  url: string
  intervalSeconds: number
}

export type MonitorListItem = Monitor & {
  /** Response time of the most recent check, if any. */
  lastResponseMs: number | null
  /** Uptime percent over the last 30 days of rollups; null before any data. */
  uptimePercent30d: number | null
}

const RECENT_CHECKS_LIMIT = 30

function validated(input: MonitorInput): {
  name: string
  url: string
  interval_seconds: number
} {
  const name = input.name.trim()
  if (name === '') {
    throw new MonitorValidationError('Give the monitor a name.')
  }
  if (name.length > 120) {
    throw new MonitorValidationError('Keep the name under 120 characters.')
  }

  const url = validateMonitorUrl(input.url)
  if (!url.ok) {
    throw new MonitorValidationError(url.reason)
  }

  if (
    !Number.isInteger(input.intervalSeconds) ||
    input.intervalSeconds < 300
  ) {
    throw new MonitorValidationError(
      'The check interval must be at least 5 minutes.',
    )
  }

  return { name, url: url.url, interval_seconds: input.intervalSeconds }
}

/** Weighted uptime percent across rollup rows; null when there are none. */
function weightedUptime(
  rows: Array<{ uptime_percent: number; check_count: number }>,
): number | null {
  const checks = rows.reduce((sum, r) => sum + r.check_count, 0)
  if (checks === 0) return null
  const up = rows.reduce(
    (sum, r) => sum + (r.uptime_percent / 100) * r.check_count,
    0,
  )
  return (up / checks) * 100
}

function rollupCutoff(): string {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  return cutoff.toISOString().slice(0, 10)
}

/** All monitors of the active org with list view stats attached. */
export async function listMonitorsWithStats(): Promise<MonitorListItem[]> {
  const { client } = await createOrgScopedClient()

  const [monitorsRes, rollupsRes] = await Promise.all([
    client
      .from('monitors')
      .select('*, monitor_checks(response_time_ms, checked_at)')
      .order('name', { ascending: true })
      .order('checked_at', { referencedTable: 'monitor_checks', ascending: false })
      .limit(1, { referencedTable: 'monitor_checks' }),
    client
      .from('monitor_daily_rollups')
      .select('monitor_id, uptime_percent, check_count')
      .gte('day', rollupCutoff()),
  ])
  if (monitorsRes.error) throw monitorsRes.error
  if (rollupsRes.error) throw rollupsRes.error

  const rollupsByMonitor = new Map<
    string,
    Array<{ uptime_percent: number; check_count: number }>
  >()
  for (const row of rollupsRes.data) {
    const list = rollupsByMonitor.get(row.monitor_id) ?? []
    list.push(row)
    rollupsByMonitor.set(row.monitor_id, list)
  }

  return monitorsRes.data.map(({ monitor_checks, ...monitor }) => ({
    ...monitor,
    lastResponseMs: monitor_checks[0]?.response_time_ms ?? null,
    uptimePercent30d: weightedUptime(rollupsByMonitor.get(monitor.id) ?? []),
  }))
}

/** One monitor by id, or null when it does not exist in the active org. */
export async function getMonitor(id: string): Promise<Monitor | null> {
  const { client } = await createOrgScopedClient()
  const { data, error } = await client
    .from('monitors')
    .select()
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data
}

/** Most recent raw checks for one monitor, newest first. */
export async function listRecentChecks(
  monitorId: string,
): Promise<MonitorCheck[]> {
  const { client } = await createOrgScopedClient()
  const { data, error } = await client
    .from('monitor_checks')
    .select()
    .eq('monitor_id', monitorId)
    .order('checked_at', { ascending: false })
    .limit(RECENT_CHECKS_LIMIT)
  if (error) throw error
  return data
}

/** Uptime percent for one monitor over the last 30 days; null before data. */
export async function getUptimePercent30d(
  monitorId: string,
): Promise<number | null> {
  const { client } = await createOrgScopedClient()
  const { data, error } = await client
    .from('monitor_daily_rollups')
    .select('uptime_percent, check_count')
    .eq('monitor_id', monitorId)
    .gte('day', rollupCutoff())
  if (error) throw error
  return weightedUptime(data)
}

export type MonitorOverviewItem = MonitorListItem & {
  /** Recent checks, oldest to newest: outcome for the uptime strip and the
   * response time for the latency sparkline. Real check history only; a
   * monitor with no checks yet has an empty array, and a check with no timing
   * (a failed connect) carries a null responseMs. */
  recentChecks: Array<{
    status: string
    responseMs: number | null
    checkedAt: string
  }>
}

/** Monitors of the active org with recent check history attached, for the
 * overview panel strips. One query; RLS scopes rows to the org. The overview
 * needs the strip that the list page (listMonitorsWithStats) does not, so it
 * embeds the last N checks rather than only the latest one. */
export async function listMonitorsWithRecentChecks(
  checkLimit = 40,
): Promise<MonitorOverviewItem[]> {
  const { client } = await createOrgScopedClient()

  const [monitorsRes, rollupsRes] = await Promise.all([
    client
      .from('monitors')
      .select('*, monitor_checks(status, response_time_ms, checked_at)')
      .order('name', { ascending: true })
      .order('checked_at', {
        referencedTable: 'monitor_checks',
        ascending: false,
      })
      .limit(checkLimit, { referencedTable: 'monitor_checks' }),
    client
      .from('monitor_daily_rollups')
      .select('monitor_id, uptime_percent, check_count')
      .gte('day', rollupCutoff()),
  ])
  if (monitorsRes.error) throw monitorsRes.error
  if (rollupsRes.error) throw rollupsRes.error

  const rollupsByMonitor = new Map<
    string,
    Array<{ uptime_percent: number; check_count: number }>
  >()
  for (const row of rollupsRes.data) {
    const list = rollupsByMonitor.get(row.monitor_id) ?? []
    list.push(row)
    rollupsByMonitor.set(row.monitor_id, list)
  }

  return monitorsRes.data.map(({ monitor_checks, ...monitor }) => ({
    ...monitor,
    lastResponseMs: monitor_checks[0]?.response_time_ms ?? null,
    uptimePercent30d: weightedUptime(rollupsByMonitor.get(monitor.id) ?? []),
    // The embed arrives newest first; reverse so the strip reads left (oldest)
    // to right (newest), the way time runs.
    recentChecks: [...monitor_checks].reverse().map((c) => ({
      status: c.status,
      responseMs: c.response_time_ms,
      checkedAt: c.checked_at,
    })),
  }))
}

/** Average response time over the last 12 hourly buckets, oldest to newest,
 * for the overview sparkline. Real checks only; returns fewer than 12 points
 * when history is thin and an empty array when there is not enough to draw a
 * line, so the caller can show an honest empty state instead of a fake trend. */
export async function responseTrend(): Promise<number[]> {
  const { client } = await createOrgScopedClient()
  const HOURS = 12
  const cutoff = new Date(Date.now() - HOURS * 60 * 60 * 1000).toISOString()

  const { data, error } = await client
    .from('monitor_checks')
    .select('response_time_ms, checked_at')
    .gte('checked_at', cutoff)
    .not('response_time_ms', 'is', null)
    .order('checked_at', { ascending: true })
  if (error) throw error
  if (data.length === 0) return []

  const now = Date.now()
  const buckets = Array.from({ length: HOURS }, () => ({ sum: 0, n: 0 }))
  for (const row of data) {
    if (row.response_time_ms === null) continue
    const ageHours = (now - Date.parse(row.checked_at)) / 3_600_000
    const idx = Math.min(HOURS - 1, Math.max(0, HOURS - 1 - Math.floor(ageHours)))
    buckets[idx].sum += row.response_time_ms
    buckets[idx].n += 1
  }
  return buckets.filter((b) => b.n > 0).map((b) => Math.round(b.sum / b.n))
}

export async function createMonitor(input: MonitorInput): Promise<Monitor> {
  const row = validated(input)
  const { client, orgId } = await createOrgScopedClient()

  // The insert needs the org's uuid, which only exists once the Clerk
  // webhook has synced the org row. RLS scopes this select to the active org.
  const { data: org, error: orgError } = await client
    .from('organizations')
    .select('id')
    .eq('clerk_org_id', orgId)
    .maybeSingle()
  if (orgError) throw orgError
  if (!org) throw new OrgNotSyncedError()

  // The plan's monitor limit (F13 PR 3): free 2, Basic 15, Pro and Business
  // unlimited. Enforced HERE, in the data layer, because the migration 003
  // insert policy is member wide: gating only the admin UI would leave the
  // action reachable around it. The count runs under the caller's own RLS,
  // so it can only ever see the active org. Two racing creates can land one
  // over the limit; the limit is packaging, not capacity, so a one monitor
  // overshoot is ours to shrug at, never a lockout.
  const { monitorLimit } = await getEntitlements(orgId)
  if (monitorLimit !== null) {
    const { count, error: countError } = await client
      .from('monitors')
      .select('id', { count: 'exact', head: true })
    if (countError) throw countError
    if ((count ?? 0) >= monitorLimit) {
      throw new MonitorValidationError(
        `Your plan includes ${monitorLimit} monitors and all ${monitorLimit} ` +
          'are in use. Upgrade under Settings, then Billing, to add more, or ' +
          'delete a monitor you no longer need. Alerts on existing monitors ' +
          'are never affected.',
      )
    }
  }

  const { data, error } = await client
    .from('monitors')
    .insert({ ...row, org_id: org.id })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateMonitor(
  id: string,
  input: MonitorInput & { active: boolean },
): Promise<Monitor | null> {
  const row = validated(input)
  const { client } = await createOrgScopedClient()
  const { data, error } = await client
    .from('monitors')
    .update({ ...row, active: input.active })
    .eq('id', id)
    .select()
    .maybeSingle()
  if (error) throw error
  return data
}

/** The pause presets the UI offers, in hours. The database enforces the 24
 * hour cap regardless; this list is what keeps the UI inside it by
 * construction. */
export const SUPPRESS_PRESET_HOURS = [1, 4, 8, 24] as const

/**
 * The until instant a preset renders to, from now. Pure and exported for the
 * unit suite: every preset must land at or under the 24 hour cap.
 */
export function suppressUntilForPreset(hours: number, nowMs: number): string {
  if (!SUPPRESS_PRESET_HOURS.includes(hours as 1 | 4 | 8 | 24)) {
    throw new MonitorValidationError('Pick one of the offered durations.')
  }
  return new Date(nowMs + hours * 60 * 60 * 1000).toISOString()
}

/**
 * Sets or clears the maintenance window on one monitor (migration 021).
 * Null resumes alerts. Runs on the org scoped client: RLS keeps it inside
 * the org, and the database gate trigger is what enforces admin only and
 * stamps suppress_set_at, so nothing here needs to. Returns null when the
 * monitor is not this org's or is gone, exactly like updateMonitor.
 */
export async function setMonitorSuppression(
  id: string,
  untilIso: string | null,
): Promise<Monitor | null> {
  const { client } = await createOrgScopedClient()
  const { data, error } = await client
    .from('monitors')
    .update({ suppress_until: untilIso })
    .eq('id', id)
    .select()
    .maybeSingle()
  if (error) throw error
  return data
}

export async function deleteMonitor(id: string): Promise<void> {
  const { client } = await createOrgScopedClient()
  const { error } = await client.from('monitors').delete().eq('id', id)
  if (error) throw error
}
