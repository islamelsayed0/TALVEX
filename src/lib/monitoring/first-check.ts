import 'server-only'

import { createAdminClient } from '@/lib/db/admin'
import { errorName, logError } from '@/lib/log'
import { runMonitorCheck, type CheckOutcome } from '@/lib/monitoring/check'

/**
 * The immediate first check after a monitor is created (docs/future_update.md,
 * "run the first check immediately on save"). The create action schedules
 * this AFTER the redirect, so saving is instant and the result lands a beat
 * later; the row shows Pending only until then instead of until the next
 * sweep.
 *
 * Same checker as the sweep, deliberately: runMonitorCheck brings the SSRF
 * guard, the 10 second timeout, and the up/down logic unforked. The write is
 * the narrow admin client exception the cron route already uses, because
 * monitor_checks and the monitors status columns are service role territory
 * by grant (migrations 003 and 020); nothing here widens any grant, it goes
 * through the one sanctioned writer path.
 *
 * Deliberately NOT here:
 *   - the incident engine: one check cannot confirm a failure (two in a row
 *     is the rule), and the sweep re decides from last_checked_at anyway;
 *   - certificate threshold notifications: dispatch stays a sweep concern,
 *     though the observed expiry IS stored so the detail page can show it
 *     immediately (the same capture rules the sweep applies);
 *   - throwing: a failed first check costs one sweep interval of feedback
 *     and nothing else. The sweep already treats a stamped last_checked_at
 *     as the clock to measure from, so no special casing follows.
 */

type FirstCheckMonitor = {
  id: string
  org_id: string
  url: string
}

type FirstCheckDeps = {
  check: (url: string) => Promise<CheckOutcome>
  db: () => Pick<ReturnType<typeof createAdminClient>, 'from'>
}

const REAL_DEPS: FirstCheckDeps = {
  check: runMonitorCheck,
  db: createAdminClient,
}

export async function runFirstCheck(
  monitor: FirstCheckMonitor,
  deps: FirstCheckDeps = REAL_DEPS,
): Promise<void> {
  try {
    const outcome = await deps.check(monitor.url)
    const db = deps.db()

    const checkedAt = new Date().toISOString()
    const { error: insertError } = await db.from('monitor_checks').insert({
      monitor_id: monitor.id,
      org_id: monitor.org_id,
      checked_at: checkedAt,
      status: outcome.status,
      response_time_ms: outcome.responseTimeMs,
      error_message: outcome.errorMessage,
    })
    if (insertError) throw new Error(insertError.message)

    const { error: updateError } = await db
      .from('monitors')
      .update({
        last_checked_at: checkedAt,
        last_status: outcome.status,
        // The sweep's capture rules (migration 020): a read expiry is
        // stored, a failed read on an https monitor keeps what is there
        // (nothing, on a row this new), and http monitors stay null.
        ...(outcome.certExpiresAt !== null
          ? { cert_expires_at: outcome.certExpiresAt }
          : {}),
      })
      .eq('id', monitor.id)
    if (updateError) throw new Error(updateError.message)
  } catch (err) {
    // Swallowed on purpose: the monitor row already stands and the next
    // sweep checks it regardless. The name only; a URL is tenant data.
    logError('monitors.first_check_failed', 'failed', { error: errorName(err) })
  }
}
