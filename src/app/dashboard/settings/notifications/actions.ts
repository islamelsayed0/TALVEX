'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getActiveOrgViewer } from '@/lib/auth/org-viewer'
import {
  NotificationSettingsValidationError,
  saveNotificationSettings,
} from '@/lib/db/notification-settings'

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
