import { NextResponse } from 'next/server'

import { createAdminClient } from '@/lib/db/admin'
import { runMonitorCheck } from '@/lib/monitoring/check'
import { isAuthorizedCronRequest } from '@/lib/monitoring/cron-auth'

/**
 * The cron sweep (architecture ruling for Phase 1 Task 1). One Vercel Cron
 * schedule invokes this route; it finds every active monitor due for a
 * check, runs the checks, writes results, prunes raw rows older than 30
 * days, and maintains the daily rollups. Each monitor's own interval is
 * respected: the sweep only checks monitors whose interval has elapsed
 * since their last check. Vercel Hobby caps the schedule at once per day
 * (vercel.json); the sweep itself is granularity agnostic, so upgrading the
 * plan only means editing the schedule line.
 *
 * Auth: CRON_SECRET bearer token, checked before anything else; requests
 * without it get 401 and touch nothing. The route is excluded from Clerk
 * middleware (src/proxy.ts) because cron invocations carry no user session.
 * It therefore runs on the service role client, which bypasses RLS: the
 * narrow no-tenant-context case admin.ts exists for. No tenant data is
 * logged, only counts.
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

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()

  const { data: monitors, error: monitorsError } = await db
    .from('monitors')
    .select('id, org_id, url, interval_seconds, last_checked_at')
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

  let up = 0
  let down = 0
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
    const { error: insertError } = await db.from('monitor_checks').insert(
      outcomes.map(({ monitor, outcome }) => ({
        monitor_id: monitor.id,
        org_id: monitor.org_id,
        checked_at: checkedAt,
        status: outcome.status,
        response_time_ms: outcome.responseTimeMs,
        error_message: outcome.errorMessage,
      })),
    )
    if (insertError) {
      failures.push(`recording checks: ${insertError.message}`)
      continue
    }

    for (const { monitor, outcome } of outcomes) {
      if (outcome.status === 'up') up++
      else down++
      const { error: updateError } = await db
        .from('monitors')
        .update({ last_checked_at: checkedAt, last_status: outcome.status })
        .eq('id', monitor.id)
      if (updateError) {
        failures.push(`updating monitor status: ${updateError.message}`)
      }
    }
  }

  // Retention: raw rows expire after 30 days; the rollups keep the history.
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
    `cron check-monitors: ${due.length} due of ${monitors.length} active, ${up} up, ${down} down`,
  )

  return NextResponse.json({
    active: monitors.length,
    checked: due.length,
    up,
    down,
    failures: failures.length,
  })
}
