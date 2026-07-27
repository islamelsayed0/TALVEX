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
import {
  notifyIncidentEvent,
  type IncidentNotifyEvent,
  type NotifyChannelSettings,
} from '@/lib/notifications/dispatch'

/**
 * The cron sweep (architecture ruling for Phase 1 Task 1). An external
 * scheduler (cron-job.org, decision log 2026-07-27) invokes this route
 * every 5 minutes: POST, Bearer CRON_SECRET, expecting a 200. The Vercel
 * Cron schedule is gone; Hobby caps it at once per day, which notifications
 * cannot live with. The sweep finds every active monitor due for a check,
 * runs the checks, writes results, runs the incident engine on each result,
 * prunes raw rows older than 30 days, and maintains the daily rollups. Each
 * monitor's own interval is respected: the sweep only checks monitors whose
 * interval has elapsed since their last check.
 *
 * Incidents (Phase 1 Task 2): after each check is recorded, the pure
 * engine in src/lib/monitoring/incident-engine.ts decides what it means
 * (await confirmation, blip, open, reopen, resolve) and this route performs
 * the writes. Confirmation rechecks ride the normal sweep: a monitor with
 * failing_since set gets rechecked on the NEXT invocation (decision log
 * 2026-07-23: never assume fresh checks). The logic is correct at any
 * cadence and tightens automatically when the schedule does.
 *
 * Notifications (F10): when an incident opens, reopens, or resolves, the
 * org's configured channels (Resend email, Discord webhook) are notified
 * from applyIncidentAction, after the incident write, never before.
 * Settings are fetched once per sweep per org. A notification failure is
 * logged and swallowed; it never fails the sweep or the incident write.
 *
 * Tickets (Phase 1 Task 3): the same sweep also closes tickets that have
 * sat resolved for more than 7 days (same route, same auth, per ruling).
 * The update sends only the status; the tickets lifecycle trigger stamps
 * closed_at and writes the auto_closed trail event, attributing it to the
 * system because the service role token carries no user.
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
// A resolved ticket closes on the first sweep after 7 full days (ruling).
const TICKET_AUTO_CLOSE_DAYS = 7

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

type Db = ReturnType<typeof createAdminClient>

type SweptMonitor = {
  id: string
  org_id: string
  name: string
  url: string
  interval_seconds: number
  last_checked_at: string | null
  failing_since: string | null
}

/**
 * Notification dispatch (F10), strictly AFTER the incident write succeeded:
 * the row stands whatever happens here. notifyIncidentEvent never throws and
 * owns the reopen cooldown; when a channel actually fired, the incident is
 * stamped so the next reopen can measure its cooldown from it. A failed
 * stamp is logged and swallowed for the same reason a failed send is: a
 * notification problem must never fail the sweep.
 */
async function notifyAndStamp(
  db: Db,
  settings: NotifyChannelSettings | undefined,
  monitor: SweptMonitor,
  event: IncidentNotifyEvent,
  incidentId: string,
  occurredAtIso: string,
  lastNotifiedAtIso: string | null,
): Promise<void> {
  if (!settings) return
  const { attempted } = await notifyIncidentEvent(
    settings,
    { name: monitor.name, url: monitor.url },
    event,
    { occurredAtIso, lastNotifiedAtIso },
  )
  if (!attempted) return
  const { error } = await db
    .from('incidents')
    .update({ last_notified_at: new Date().toISOString() })
    .eq('id', incidentId)
  if (error) {
    console.error('cron check-monitors: stamping last_notified_at failed:', error.message)
  }
}

/**
 * Performs the writes one engine action describes. Returns the value
 * monitors.failing_since must take (undefined when it stays untouched) so
 * the caller can fold it into the monitor's status update, plus which
 * incident counter to bump. Open, reopen, and resolve dispatch notifications
 * here and nowhere else, always after their write succeeded.
 */
async function applyIncidentAction(
  db: Db,
  monitor: SweptMonitor,
  action: EngineAction,
  settings: NotifyChannelSettings | undefined,
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
      await notifyAndStamp(db, settings, monitor, 'open', incident.id, action.openedAt, null)
      return { failingSince: null, counted: 'opened' }
    }
    case 'reopen': {
      // The update does not touch last_notified_at, so selecting it back
      // returns the value from before this reopen: exactly what the
      // cooldown must measure against.
      const { data: reopened, error } = await db
        .from('incidents')
        .update({
          status: 'open',
          resolved_at: null,
          last_reopened_at: action.reopenedAt,
        })
        .eq('id', action.incidentId)
        .select('last_notified_at')
        .single()
      if (error) throw new Error(`reopening incident: ${error.message}`)
      await appendEvents(db, monitor.org_id, action.incidentId, action.events)
      await notifyAndStamp(
        db,
        settings,
        monitor,
        'reopen',
        action.incidentId,
        action.reopenedAt,
        reopened.last_notified_at,
      )
      return { failingSince: null, counted: 'reopened' }
    }
    case 'resolve': {
      const { error } = await db
        .from('incidents')
        .update({ status: 'resolved', resolved_at: action.resolvedAt })
        .eq('id', action.incidentId)
      if (error) throw new Error(`resolving incident: ${error.message}`)
      await appendEvents(db, monitor.org_id, action.incidentId, action.events)
      await notifyAndStamp(
        db,
        settings,
        monitor,
        'resolve',
        action.incidentId,
        action.resolvedAt,
        null,
      )
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

async function runSweep(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()

  const { data: monitors, error: monitorsError } = await db
    .from('monitors')
    .select('id, org_id, name, url, interval_seconds, last_checked_at, failing_since')
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

  // Notification settings, fetched once per sweep for every org with a due
  // monitor (batched, never per monitor). A fetch failure only silences
  // notifications for this sweep; the checks and incident writes proceed.
  const settingsByOrg = new Map<string, NotifyChannelSettings>()
  if (due.length > 0) {
    const orgIds = [...new Set(due.map((m) => m.org_id))]
    const { data: settingsRows, error: settingsError } = await db
      .from('org_notification_settings')
      .select(
        'org_id, notification_email, discord_webhook, email_on_open, email_on_resolve, alert_cooldown_minutes',
      )
      .in('org_id', orgIds)
    if (settingsError) {
      console.error(
        'cron check-monitors: listing notification settings failed:',
        settingsError.message,
      )
    } else {
      for (const row of settingsRows) {
        settingsByOrg.set(row.org_id, {
          notificationEmail: row.notification_email,
          discordWebhook: row.discord_webhook,
          emailOnOpen: row.email_on_open,
          emailOnResolve: row.email_on_resolve,
          alertCooldownMinutes: row.alert_cooldown_minutes,
        })
      }
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
        const applied = await applyIncidentAction(
          db,
          monitor,
          action,
          settingsByOrg.get(monitor.org_id),
        )
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

  // Tickets: anything resolved more than 7 days ago closes now. Only the
  // status is written; the lifecycle trigger owns closed_at and the
  // auto_closed trail event.
  const ticketCutoff = new Date(
    now - TICKET_AUTO_CLOSE_DAYS * 24 * 60 * 60 * 1000,
  )
  const { data: autoClosed, error: autoCloseError } = await db
    .from('tickets')
    .update({ status: 'closed' })
    .eq('status', 'resolved')
    .lt('resolved_at', ticketCutoff.toISOString())
    .select('id')
  if (autoCloseError) {
    failures.push(`auto closing tickets: ${autoCloseError.message}`)
  }
  const ticketsClosed = autoClosed?.length ?? 0

  if (failures.length > 0) {
    console.error(`cron check-monitors: ${failures.length} step(s) failed:`, failures.join('; '))
  }
  console.log(
    `cron check-monitors: ${due.length} due of ${monitors.length} active, ` +
      `${up} up, ${down} down; incidents ${incidentCounts.opened} opened, ` +
      `${incidentCounts.reopened} reopened, ${incidentCounts.resolved} resolved; ` +
      `tickets ${ticketsClosed} auto closed`,
  )

  return NextResponse.json({
    active: monitors.length,
    checked: due.length,
    up,
    down,
    incidents: incidentCounts,
    ticketsClosed,
    failures: failures.length,
  })
}

// The scheduler contract is POST (decision log 2026-07-27). GET stays for
// manual invocation and for anything still holding the old contract; both
// require the same bearer token and run the same sweep.
export async function GET(request: Request) {
  return runSweep(request)
}

export async function POST(request: Request) {
  return runSweep(request)
}
