import 'server-only'

import { Resend } from 'resend'

/**
 * Alert emails via Resend (BRD F10). Ported from NetPulse
 * lib/notifications/resend-alerts.ts: the graceful degradation and the one
 * time log guard pattern survive; the copy is Talvex and the bodies are
 * plain text only in this PR. Nothing here touches the database.
 *
 * Degrades gracefully: a deployment without RESEND_API_KEY or RESEND_FROM
 * skips email entirely and says so once in the logs, instead of failing the
 * sweep on every incident. Recipient addresses are tenant data and are never
 * logged.
 */

let missingKeyLogged = false
let missingFromLogged = false

/** Test hook: resets the one time log guards so each test observes them fresh. */
export function resetEmailLogGuards(): void {
  missingKeyLogged = false
  missingFromLogged = false
}

type ResendConfig =
  | { ok: true; resend: Resend; from: string }
  | { ok: false; reason: string }

/**
 * The Resend client plus verified From, or a reason it is unavailable. The
 * reason is a config message safe to show an admin (never a key or address);
 * sendAlertEmail ignores it and skips, the test send surfaces it.
 */
function resendConfig(): ResendConfig {
  const key = process.env.RESEND_API_KEY?.trim()
  if (!key) {
    if (!missingKeyLogged) {
      missingKeyLogged = true
      console.error('notifications: RESEND_API_KEY is not set; alert emails are skipped.')
    }
    return { ok: false, reason: 'RESEND_API_KEY is not set in the deployment.' }
  }
  const from = process.env.RESEND_FROM?.trim()
  if (!from) {
    if (!missingFromLogged) {
      missingFromLogged = true
      console.error('notifications: RESEND_FROM is not set; alert emails are skipped.')
    }
    return { ok: false, reason: 'RESEND_FROM is not set in the deployment.' }
  }
  return { ok: true, resend: new Resend(key), from }
}

/** "2026-07-27T16:50:38.182Z" as the calmer "2026-07-27 16:50 UTC". */
function formatUtcMinute(iso: string): string {
  return `${iso.slice(0, 16).replace('T', ' ')} UTC`
}

export type AlertEmail = { subject: string; text: string }

/** The email for a confirmed failure, opening or reopening an incident. */
export function buildDownEmail(input: {
  monitorName: string
  monitorUrl: string
  occurredAtIso: string
  reopened: boolean
}): AlertEmail {
  const lead = input.reopened
    ? `${input.monitorName} went down again shortly after recovering, so its incident reopened.`
    : `${input.monitorName} is not responding. Two checks in a row failed, so an incident is open.`
  return {
    subject: `[Talvex] ${input.monitorName} is down`,
    text: [
      lead,
      '',
      `Monitor: ${input.monitorName}`,
      `URL: ${input.monitorUrl}`,
      `Down since: ${formatUtcMinute(input.occurredAtIso)}`,
      '',
      'Talvex keeps checking and resolves the incident on the first healthy response.',
    ].join('\n'),
  }
}

/** The email for a recovery, resolving the incident. */
export function buildRecoveredEmail(input: {
  monitorName: string
  monitorUrl: string
  occurredAtIso: string
}): AlertEmail {
  return {
    subject: `[Talvex] ${input.monitorName} recovered`,
    text: [
      `${input.monitorName} responded normally again and its incident resolved.`,
      '',
      `Monitor: ${input.monitorName}`,
      `URL: ${input.monitorUrl}`,
      `Recovered at: ${formatUtcMinute(input.occurredAtIso)}`,
    ].join('\n'),
  }
}

/**
 * Sends one alert email. Never throws: missing configuration skips quietly
 * (logged once), and a provider failure logs a status only line. The
 * recipient address never appears in a log.
 */
export async function sendAlertEmail(input: {
  to: string
  subject: string
  text: string
}): Promise<void> {
  const cfg = resendConfig()
  if (!cfg.ok) return
  try {
    const { error } = await cfg.resend.emails.send({
      from: cfg.from,
      to: input.to,
      subject: input.subject,
      text: input.text,
    })
    if (error) {
      console.error(`notifications: Resend send failed (${error.name})`)
    }
  } catch {
    console.error('notifications: Resend send failed (request error)')
  }
}

/** The email body for a test triggered from Settings. Not a real incident. */
export function buildTestEmail(): AlertEmail {
  return {
    subject: '[Talvex] Test notification',
    text: [
      'Your Talvex alerts are set up correctly.',
      '',
      'This is a test you triggered from Settings, not a real incident.',
    ].join('\n'),
  }
}

export type EmailSendResult = { ok: true } | { ok: false; reason: string }

/**
 * Like sendAlertEmail, but reports the outcome instead of swallowing it, so
 * the Settings test button can tell the admin whether the email actually went
 * out and why not. The reason is a config or provider status message, never a
 * key or the recipient address.
 */
export async function sendAlertEmailResult(input: {
  to: string
  subject: string
  text: string
}): Promise<EmailSendResult> {
  const cfg = resendConfig()
  if (!cfg.ok) return { ok: false, reason: cfg.reason }
  try {
    const { error } = await cfg.resend.emails.send({
      from: cfg.from,
      to: input.to,
      subject: input.subject,
      text: input.text,
    })
    if (error) return { ok: false, reason: `Resend rejected it (${error.name}).` }
    return { ok: true }
  } catch {
    return { ok: false, reason: 'The email request failed.' }
  }
}
