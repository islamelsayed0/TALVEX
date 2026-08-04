import 'server-only'

import {
  DISCORD_DOWN_COLOR,
  normalizeDiscordWebhookUrl,
  postDiscordWebhook,
} from '@/lib/notifications/discord'

/**
 * Errors that reach a human, without adding an error tracking service.
 *
 * The gap being closed is retention, not detection. Structured logging already
 * gives every failure a filterable shape, but on Vercel Hobby the runtime logs
 * evaporate quickly, so a failure that happens while nobody is watching leaves
 * no trace. Posting the lines that matter to a channel the operator already
 * reads makes them durable, searchable, and notified, for no new dependency
 * and no money.
 *
 * This deliberately reuses the F10 Discord poster: it is already hardened
 * (never throws, never logs the URL) and already normalizes webhook URLs.
 *
 * OPS_DISCORD_WEBHOOK is platform level and has nothing to do with any org's
 * discord_webhook in org_notification_settings. A customer's channel must
 * never receive Talvext's internal failures, and the operator's channel must
 * never receive a customer's incidents.
 *
 * Honest limitation, and the reason the external watcher is a separate thing:
 * this sink runs inside the same deployment that produced the error. If the
 * whole deployment is down, nothing here reports. Only something outside can
 * catch that.
 */

let missingWebhookLogged = false

/** Test hook: resets the one time log guard so each test observes it fresh. */
export function resetOpsReportGuard(): void {
  missingWebhookLogged = false
}

export type OpsReport = {
  /** The stable event name, matching the log line this accompanies. */
  event: string
  /** A short scrubbed reason. Never a stack, a body, or anything tenant shaped. */
  reason?: string
}

/**
 * Posts one operational failure to the operator channel. Never throws, and
 * never returns a failure: a reporting problem must not become a second
 * incident on top of the one being reported.
 */
export async function reportOpsError(report: OpsReport): Promise<void> {
  const raw = process.env.OPS_DISCORD_WEBHOOK?.trim()
  if (!raw) {
    if (!missingWebhookLogged) {
      missingWebhookLogged = true
      // Imported lazily so this module can be read without pulling the logger
      // into a cycle: log.ts calls into here.
      const { logError } = await import('@/lib/log')
      logError('ops.report.not_configured', 'unavailable', {
        variable: 'OPS_DISCORD_WEBHOOK',
      })
    }
    return
  }

  const url = normalizeDiscordWebhookUrl(raw)
  if (!url) return

  try {
    await postDiscordWebhook(url, {
      title: 'Talvext platform error',
      description: 'A server side step failed. Check the runtime logs for the full line.',
      color: DISCORD_DOWN_COLOR,
      fields: [
        { name: 'Event', value: report.event, inline: true },
        ...(report.reason ? [{ name: 'Reason', value: report.reason, inline: true }] : []),
      ],
    })
  } catch {
    // Swallowed on purpose. postDiscordWebhook already never throws; this is
    // the belt to its braces, because the caller is usually a catch block.
  }
}
