import { NextResponse } from 'next/server'

import { createAdminClient } from '@/lib/db/admin'
import { runMonitorCheck } from '@/lib/monitoring/check'
import { isAuthorizedCronRequest } from '@/lib/monitoring/cron-auth'
import {
  decide,
  type EngineAction,
  type EngineState,
  type IncidentEventInput,
} from '@/lib/monitoring/incident-engine'

/**
 * The cron sweep (architecture ruling for Phase 1 Task 1). One Vercel Cron
 * schedule invokes this route; it finds every active monitor due for a
 * check, runs the checks, writes results, runs the incident engine on each
 * result, prunes raw rows older than 30 days, and maintains the daily
 * rollups. Each monitor's own interval is respected: the sweep only checks
 * monitors whose interval has elapsed since their last check. Vercel Hobby
 * caps the schedule at once per day (vercel.json); the sweep itself is
 * granularity agnostic, so upgrading the plan only means editing the
 * schedule line.
 *
 * Incidents (Phase 1 Task 2): after each check is recorded, the pure
 * engine in src/lib/monitoring/incident-engine.ts decides what it means
 * (await confirmation, blip, open, reopen, resolve) and this route performs
 * the writes. Confirmation rechecks ride the normal sweep: a monitor with
 * failing_since set gets rechecked on the NEXT invocation, which on the
 * daily Hobby cron is up to a day later (decision log 2026-07-23: never
 * assume fresh checks). The logic is correct at any cadence and tightens
 * automatically when the schedule does.
 *
 * Auth: CRON_SECRET bearer token, checked before anything else; requests
 * without it get 401 and touch nothing. The route is excluded from Clerk
 * middleware (src/proxy.ts) because cron invocations carry no user session.
 * It therefore runs on the service role client, which bypasses RLS: the
 * narrow no-tenant-context case admin.ts exists for. Incidents and their
 * timeline events are written ONLY here; user sessions can read them and
 * nothing else. No tenant data is logged, only counts.
 */

// Never static, never cached: every invocation must sweep.
export const dynamic = 'force-dynamic'
// Within every Vercel plan's function ceiling. With batches of 10 and a 10
// second per check timeout, this comfortably covers Phase 1 monitor counts.
export const maxDuration = 60

const RETENTION_DAYS = 30
const BATCH_SIZE = 10

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

type Db = ReturnType<typeof createAdminClient>

type SweptMonitor = {
  id: string
  org_id: string
  url: string
  interval_seconds: number
  last_checked_at: string | null
  failing_since: string | null
}

/**
 * Performs the writes one engine action describes. Returns the value
 * monitors.failing_since must take (undefined when it stays untouched) so
 * the caller can fold it into the monitor's status update, plus which
 * incident counter to bump.
 */
async function applyIncidentAction(
  db: Db,
  monitor: SweptMonitor,
  action: EngineAction,
): Promise<{ failingSince?: string | null; counted?: 'opened' | 'reopened' | 'resolved' }> {
  switch (action.kind) {
    case 'none':
      return {}
    case 'await_confirmation':
      return { failingSince: action.failingSince }
    case 'record_blip':
      return { failingSince: null }
    case 'open': {
      const { data: incident, error } = await db
        .from('incidents')
        .insert({
          org_id: monitor.org_id,
          monitor_id: monitor.id,
          status: 'open',
          opened_at: action.openedAt,
        })
        .select('id')
        .single()
      if (error) throw new Error(`opening incident: ${error.message}`)
      await appendEvents(db, monitor.org_id, incident.id, action.events)
      return { failingSince: null, counted: 'opened' }
    }
    case 'reopen': {
      const { error } = await db
        .from('incidents')
        .update({
          status: 'open',
          resolved_at: null,
          last_reopened_at: action.reopenedAt,
        })
        .eq('id', action.incidentId)
      if (error) throw new Error(`reopening incident: ${error.message}`)
      await appendEvents(db, monitor.org_id, action.incidentId, action.events)
      return { failingSince: null, counted: 'reopened' }
    }
    case 'resolve': {
      const { error } = await db
        .from('incidents')
        .update({ status: 'resolved', resolved_at: action.resolvedAt })
        .eq('id', action.incidentId)
      if (error) throw new Error(`resolving incident: ${error.message}`)
      await appendEvents(db, monitor.org_id, action.incidentId, action.events)
      return { failingSince: null, counted: 'resolved' }
    }
  }
}

async function appendEvents(
  db: Db,
  orgId: string,
  incidentId: string,
  events: IncidentEventInput[],
): Promise<void> {
  const { error } = await db.from('incident_events').insert(
    events.map((e) => ({
      org_id: orgId,
      incident_id: incidentId,
      event_type: e.eventType,
      occurred_at: e.occurredAt,
      check_id: e.checkId,
      detail: e.detail,
    })),
  )
  if (error) throw new Error(`writing timeline events: ${error.message}`)
}

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()

  const { data: monitors, error: monitorsError } = await db
    .from('monitors')
    .select('id, org_id, url, interval_seconds, last_checked_at, failing_since')
    .eq('active', true)
  if (monitorsError) {
    console.error('cron check-monitors: listing monitors failed:', monitorsError.message)
    return NextResponse.json({ error: 'monitor listing failed' }, { status: 500 })
  }

  // Due when never checked, or when the monitor's own interval has elapsed.
  // Filtered here rather than in SQL because PostgREST cannot compare two
  // columns; the monitor counts this sweeps stay small in Phase 1.
  const now = Date.now()
  const due = monitors.filter(
    (m) =>
      m.last_checked_at === null ||
      now - Date.parse(m.last_checked_at) >= m.interval_seconds * 1000,
  )

  // One query answers "which due monitors have an open incident" for the
  // whole sweep; each monitor appears at most once per sweep, so the map
  // cannot go stale within it.
  const openIncidentByMonitor = new Map<string, string>()
  if (due.length > 0) {
    const { data: openIncidents, error: openError } = await db
      .from('incidents')
      .select('id, monitor_id')
      .in('monitor_id', due.map((m) => m.id))
      .eq('status', 'open')
    if (openError) {
      console.error('cron check-monitors: listing open incidents failed:', openError.message)
      return NextResponse.json({ error: 'incident listing failed' }, { status: 500 })
    }
    for (const incident of openIncidents) {
      openIncidentByMonitor.set(incident.monitor_id, incident.id)
    }
  }

  let up = 0
  let down = 0
  const incidentCounts = { opened: 0, reopened: 0, resolved: 0 }
  const failures: string[] = []

  for (let i = 0; i < due.length; i += BATCH_SIZE) {
    const batch = due.slice(i, i + BATCH_SIZE)
    const outcomes = await Promise.all(
      batch.map(async (monitor) => ({
        monitor,
        outcome: await runMonitorCheck(monitor.url),
      })),
    )

    const checkedAt = new Date().toISOString()
    const { data: checkRows, error: insertError } = await db
      .from('monitor_checks')
      .insert(
        outcomes.map(({ monitor, outcome }) => ({
          monitor_id: monitor.id,
          org_id: monitor.org_id,
          checked_at: checkedAt,
          status: outcome.status,
          response_time_ms: outcome.responseTimeMs,
          error_message: outcome.errorMessage,
        })),
      )
      .select('id, monitor_id')
    if (insertError) {
      failures.push(`recording checks: ${insertError.message}`)
      continue
    }
    const checkIdByMonitor = new Map(
      checkRows.map((c) => [c.monitor_id, c.id]),
    )

    for (const { monitor, outcome } of outcomes) {
      if (outcome.status === 'up') up++
      else down++

      // The engine needs the monitor's most recent resolved incident only
      // when this check confirms a failure; that lookup is rare, so it runs
      // lazily here instead of joining for every monitor in the sweep.
      const openIncidentId = openIncidentByMonitor.get(monitor.id) ?? null
      let lastResolved: EngineState['lastResolved'] = null
      if (
        outcome.status === 'down' &&
        monitor.failing_since !== null &&
        openIncidentId === null
      ) {
        const { data: recent, error: recentError } = await db
          .from('incidents')
          .select('id, resolved_at')
          .eq('monitor_id', monitor.id)
          .eq('status', 'resolved')
          .order('resolved_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (recentError) {
          failures.push(`reading last incident: ${recentError.message}`)
          continue
        }
        if (recent?.resolved_at) {
          lastResolved = { incidentId: recent.id, resolvedAt: recent.resolved_at }
        }
      }

      const action = decide(
        {
          failingSince: monitor.failing_since,
          openIncidentId,
          lastResolved,
        },
        {
          id: checkIdByMonitor.get(monitor.id)!,
          status: outcome.status,
          checkedAt,
        },
      )

      let failingSince: string | null | undefined
      try {
        const applied = await applyIncidentAction(db, monitor, action)
        failingSince = applied.failingSince
        if (applied.counted) incidentCounts[applied.counted]++
      } catch (err) {
        failures.push(err instanceof Error ? err.message : String(err))
        // Leave failing_since untouched so the next sweep re-decides from
        // the same state rather than losing the pending confirmation.
        failingSince = undefined
      }

      const { error: updateError } = await db
        .from('monitors')
        .update({
          last_checked_at: checkedAt,
          last_status: outcome.status,
          ...(failingSince !== undefined ? { failing_since: failingSince } : {}),
        })
        .eq('id', monitor.id)
      if (updateError) {
        failures.push(`updating monitor status: ${updateError.message}`)
      }
    }
  }

  // Retention: raw rows expire after 30 days; the rollups keep the history.
  // incident_events.check_id references go NULL with the pruned rows; the
  // timeline itself is permanent.
  const cutoff = new Date(now - RETENTION_DAYS * 24 * 60 * 60 * 1000)
  const { error: pruneError } = await db
    .from('monitor_checks')
    .delete()
    .lt('checked_at', cutoff.toISOString())
  if (pruneError) {
    failures.push(`pruning: ${pruneError.message}`)
  }

  // Recompute today's rollups, and yesterday's too so the sweep straddling
  // the UTC day boundary finalizes the previous day.
  for (const day of [utcDay(new Date()), utcDay(new Date(now - 24 * 60 * 60 * 1000))]) {
    const { error: rollupError } = await db.rpc('upsert_monitor_daily_rollups', {
      p_day: day,
    })
    if (rollupError) {
      failures.push(`rollup ${day}: ${rollupError.message}`)
    }
  }

  if (failures.length > 0) {
    console.error(`cron check-monitors: ${failures.length} step(s) failed:`, failures.join('; '))
  }
  console.log(
    `cron check-monitors: ${due.length} due of ${monitors.length} active, ` +
      `${up} up, ${down} down; incidents ${incidentCounts.opened} opened, ` +
      `${incidentCounts.reopened} reopened, ${incidentCounts.resolved} resolved`,
  )

  return NextResponse.json({
    active: monitors.length,
    checked: due.length,
    up,
    down,
    incidents: incidentCounts,
    failures: failures.length,
  })
}
