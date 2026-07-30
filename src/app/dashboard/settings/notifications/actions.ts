'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getActiveOrgViewer } from '@/lib/auth/org-viewer'
import {
  NotificationSettingsValidationError,
  getNotificationSettings,
  saveDigestSettings,
  saveNotificationSettings,
} from '@/lib/db/notification-settings'
import { buildTestEmbed, postDiscordWebhook } from '@/lib/notifications/discord'
import { buildTestEmail, sendAlertEmailResult } from '@/lib/notifications/email'

/**
 * Server action for notification settings, the api-keys actions.ts shape.
 * RLS is the real boundary (admin only, migration 010), but this also gates
 * on isAdmin before doing any work. A bad webhook URL or email is a form
 * error carried back in the query string, never a silent drop. redirect()
 * throws, so it is only called outside the try block.
 */

const PAGE = '/dashboard/settings/notifications'

export async function saveNotificationSettingsAction(
  formData: FormData,
): Promise<void> {
  const viewer = await getActiveOrgViewer()
  if (!viewer.isAdmin) redirect(PAGE)

  const cooldownRaw = String(formData.get('alert_cooldown_minutes') ?? '').trim()
  const input = {
    notificationEmail: String(formData.get('notification_email') ?? ''),
    discordWebhook: String(formData.get('discord_webhook') ?? ''),
    emailOnOpen: formData.get('email_on_open') === 'on',
    emailOnResolve: formData.get('email_on_resolve') === 'on',
    alertCooldownMinutes: /^\d+$/.test(cooldownRaw) ? Number(cooldownRaw) : NaN,
  }

  let failure: string | null = null
  try {
    await saveNotificationSettings(input)
  } catch (err) {
    if (err instanceof NotificationSettingsValidationError) {
      failure = err.message
    } else {
      throw err
    }
  }
  if (failure !== null) {
    redirect(`${PAGE}?${new URLSearchParams({ error: failure })}`)
  }

  revalidatePath(PAGE)
  redirect(`${PAGE}?saved=1`)
}

/**
 * Saves the daily digest settings. Separate from the alerts form above so
 * saving one never rewrites the other; the digest columns are the only ones
 * this touches. Same admin gate, same validation carried back in the query
 * string. The sweep's ledger column is not writable from any user session, so
 * nothing here can affect when a digest has already been sent.
 */
export async function saveDigestSettingsAction(
  formData: FormData,
): Promise<void> {
  const viewer = await getActiveOrgViewer()
  if (!viewer.isAdmin) redirect(PAGE)

  const input = {
    digestEnabled: formData.get('digest_enabled') === 'on',
    digestSendTime: String(formData.get('digest_send_time') ?? ''),
  }

  let failure: string | null = null
  try {
    await saveDigestSettings(input)
  } catch (err) {
    if (err instanceof NotificationSettingsValidationError) {
      failure = err.message
    } else {
      throw err
    }
  }
  if (failure !== null) {
    redirect(`${PAGE}?${new URLSearchParams({ error: failure })}`)
  }

  revalidatePath(PAGE)
  redirect(`${PAGE}?saved=digest`)
}

/**
 * Sends a test notification to the org's SAVED channels so an admin can
 * confirm a webhook or email works without waiting for a real incident. It
 * uses the saved settings, not the unsaved form, so save first. Reports each
 * channel's outcome back in the query string; nothing sensitive is carried.
 */
export async function sendTestNotificationAction(): Promise<void> {
  const viewer = await getActiveOrgViewer()
  if (!viewer.isAdmin) redirect(PAGE)

  const settings = await getNotificationSettings()
  const webhook = settings?.discord_webhook?.trim()
  const email = settings?.notification_email?.trim()

  const results: string[] = []
  if (webhook) {
    const r = await postDiscordWebhook(webhook, buildTestEmbed())
    results.push(r.ok ? 'Discord: sent' : `Discord: ${r.error}`)
  }
  if (email) {
    const r = await sendAlertEmailResult({ to: email, ...buildTestEmail() })
    results.push(r.ok ? 'Email: sent' : `Email: ${r.reason}`)
  }

  const tested = results.length === 0 ? 'none' : results.join(' · ')
  redirect(`${PAGE}?${new URLSearchParams({ tested })}`)
}
