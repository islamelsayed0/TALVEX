import 'server-only'

import { logError } from '@/lib/log'

import {
  buildCertExpiryEmbed,
  buildDownEmbed,
  buildRecoveredEmbed,
  postDiscordWebhook,
  type DiscordEmbed,
} from './discord'
import {
  buildCertExpiryEmail,
  buildDownEmail,
  buildRecoveredEmail,
  sendAlertEmail,
} from './email'

/**
 * The single fan out point for incident notifications (BRD F10). The cron
 * sweep calls notifyIncidentEvent after an incident write succeeds, and this
 * module decides which channels fire based on the org's settings row. It is
 * rewritten from NetPulse lib/notifications/monitor-notify.ts against this
 * project's shapes; the never throw discipline is the part that ported.
 *
 * Guarantees the sweep relies on:
 *   - Never throws. A provider failure is logged (status only, no tenant
 *     data, no URLs, no addresses) and swallowed; the incident row already
 *     stands and the sweep moves on.
 *   - The reopen cooldown lives here: a reopen inside alertCooldownMinutes
 *     of the incident's last notification sends nothing on any channel.
 *     Opens and resolves always send.
 *   - The email toggles gate email only. Discord fires for every event
 *     whenever a webhook is configured; configuring it is the opt in.
 */

export type IncidentNotifyEvent = 'open' | 'reopen' | 'resolve'

/** The org's settings row, as the data layer or the cron sweep reads it. */
export type NotifyChannelSettings = {
  notificationEmail: string | null
  discordWebhook: string | null
  emailOnOpen: boolean
  emailOnResolve: boolean
  alertCooldownMinutes: number
}

export type NotifyMonitor = { name: string; url: string }

export type NotifyContext = {
  /** When the event happened (openedAt, reopenedAt, or resolvedAt). */
  occurredAtIso: string
  /** incidents.last_notified_at before this event, for the reopen cooldown. */
  lastNotifiedAtIso: string | null
}

/**
 * The channel transports, injectable so the unit suite can drive every
 * branch without a network. Production callers omit this and get the real
 * Resend and Discord senders.
 */
export type NotifySenders = {
  sendEmail: (input: { to: string; subject: string; text: string }) => Promise<void>
  postDiscord: (
    webhookUrl: string,
    embed: DiscordEmbed,
  ) => Promise<{ ok: true } | { ok: false; error: string }>
}

const REAL_SENDERS: NotifySenders = {
  sendEmail: sendAlertEmail,
  postDiscord: postDiscordWebhook,
}

/**
 * True when a maintenance window is holding this monitor's notifications at
 * the given instant. Suppression silences NOTIFICATIONS ONLY (migration 021):
 * checks still run, incidents still open and resolve, the timeline stays
 * true; a suppressed send is skipped, not queued. The catch up in the cron
 * sweep is what keeps a real outage that outlives the window from being
 * swallowed.
 */
export function suppressedAt(
  suppressUntilIso: string | null,
  atMs: number,
): boolean {
  if (suppressUntilIso === null) return false
  const until = Date.parse(suppressUntilIso)
  return !Number.isNaN(until) && atMs < until
}

/**
 * True when an open incident must be alerted now that its monitor's window
 * has expired (spec ruling 5): the window is over, and the incident was
 * never notified after the window was set, whether because it opened inside
 * the window or because its only notification predates it. Without this, a
 * real outage that outlived the window would stay silent forever.
 */
export function needsCatchUp(input: {
  suppressUntilIso: string | null
  suppressSetAtIso: string | null
  lastNotifiedAtIso: string | null
  nowMs: number
}): boolean {
  if (input.suppressUntilIso === null) return false
  const until = Date.parse(input.suppressUntilIso)
  if (Number.isNaN(until) || input.nowMs < until) return false
  if (input.lastNotifiedAtIso === null) return true
  const setAt =
    input.suppressSetAtIso === null ? NaN : Date.parse(input.suppressSetAtIso)
  return !Number.isNaN(setAt) && Date.parse(input.lastNotifiedAtIso) < setAt
}

/**
 * True when a reopen at occurredAtIso falls inside the cooldown window
 * measured from the incident's last notification. Only reopens are ever
 * suppressed; open and resolve ignore the window entirely.
 */
export function reopenInsideCooldown(
  event: IncidentNotifyEvent,
  context: NotifyContext,
  cooldownMinutes: number,
): boolean {
  if (event !== 'reopen') return false
  if (context.lastNotifiedAtIso === null) return false
  const elapsedMs =
    Date.parse(context.occurredAtIso) - Date.parse(context.lastNotifiedAtIso)
  return elapsedMs < cooldownMinutes * 60 * 1000
}

/**
 * Fans one incident event out to the configured channels. Returns whether
 * any channel was actually invoked, so the caller can stamp
 * incidents.last_notified_at only when a notification really went out.
 */
export async function notifyIncidentEvent(
  settings: NotifyChannelSettings,
  monitor: NotifyMonitor,
  event: IncidentNotifyEvent,
  context: NotifyContext,
  senders: NotifySenders = REAL_SENDERS,
): Promise<{ attempted: boolean }> {
  if (reopenInsideCooldown(event, context, settings.alertCooldownMinutes)) {
    return { attempted: false }
  }

  const down = event !== 'resolve'
  let attempted = false

  const email = settings.notificationEmail?.trim()
  const emailEnabled = down ? settings.emailOnOpen : settings.emailOnResolve
  if (email && emailEnabled) {
    attempted = true
    const body = down
      ? buildDownEmail({
          monitorName: monitor.name,
          monitorUrl: monitor.url,
          occurredAtIso: context.occurredAtIso,
          reopened: event === 'reopen',
        })
      : buildRecoveredEmail({
          monitorName: monitor.name,
          monitorUrl: monitor.url,
          occurredAtIso: context.occurredAtIso,
        })
    try {
      await senders.sendEmail({ to: email, subject: body.subject, text: body.text })
    } catch {
      logError('notifications.dispatch.email_failed', 'failed')
    }
  }

  const webhook = settings.discordWebhook?.trim()
  if (webhook) {
    attempted = true
    const embed = down
      ? buildDownEmbed({
          monitorName: monitor.name,
          monitorUrl: monitor.url,
          occurredAtIso: context.occurredAtIso,
          reopened: event === 'reopen',
        })
      : buildRecoveredEmbed({
          monitorName: monitor.name,
          monitorUrl: monitor.url,
          occurredAtIso: context.occurredAtIso,
        })
    try {
      const result = await senders.postDiscord(webhook, embed)
      if (!result.ok) {
        // result.error is a status line built by discord.ts, never the webhook
        // URL and never the embed contents.
        logError('notifications.dispatch.discord_rejected', 'rejected', {
          reason: result.error,
        })
      }
    } catch {
      logError('notifications.dispatch.discord_failed', 'failed')
    }
  }

  return { attempted }
}

/**
 * Fans one certificate expiry warning out to the configured channels. A
 * warning, not an incident: nothing here touches the incidents tables, and
 * dedup lives in monitors.cert_alerted_threshold, written by the caller, so
 * this function carries no cooldown logic.
 *
 * Gating: the email rides emailOnOpen, the problem opening toggle, so an org
 * that silenced problem emails is not surprised by a new kind of them.
 * Discord fires whenever a webhook is configured, the standing channel
 * contract. Same never throw discipline as notifyIncidentEvent.
 */
export async function notifyCertExpiry(
  settings: NotifyChannelSettings,
  monitor: NotifyMonitor,
  info: { daysLeft: number; expiresAtIso: string; expired: boolean },
  senders: NotifySenders = REAL_SENDERS,
): Promise<{ attempted: boolean }> {
  let attempted = false

  const email = settings.notificationEmail?.trim()
  if (email && settings.emailOnOpen) {
    attempted = true
    const body = buildCertExpiryEmail({
      monitorName: monitor.name,
      monitorUrl: monitor.url,
      daysLeft: info.daysLeft,
      expiresAtIso: info.expiresAtIso,
      expired: info.expired,
    })
    try {
      await senders.sendEmail({ to: email, subject: body.subject, text: body.text })
    } catch {
      logError('notifications.dispatch.cert_email_failed', 'failed')
    }
  }

  const webhook = settings.discordWebhook?.trim()
  if (webhook) {
    attempted = true
    const embed = buildCertExpiryEmbed({
      monitorName: monitor.name,
      monitorUrl: monitor.url,
      daysLeft: info.daysLeft,
      expiresAtIso: info.expiresAtIso,
      expired: info.expired,
    })
    try {
      const result = await senders.postDiscord(webhook, embed)
      if (!result.ok) {
        logError('notifications.dispatch.cert_discord_rejected', 'rejected', {
          reason: result.error,
        })
      }
    } catch {
      logError('notifications.dispatch.cert_discord_failed', 'failed')
    }
  }

  return { attempted }
}
