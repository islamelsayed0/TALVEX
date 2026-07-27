import { normalizeDiscordWebhookUrl } from '@/lib/notifications/discord'
import { createOrgScopedClient } from './client'
import { OrgNotSyncedError } from './monitors'
import type { OrgNotificationSettings } from './types'

/**
 * Typed data layer for notification settings (F10, CLAUDE.md code rule 7).
 * Everything here runs on the org scoped client, so RLS has already applied
 * the admin only rule (migration 010) before any code sees a row: a member
 * reaches nothing here. The cron sweep reads the table separately through the
 * service role, the same way it reads everything else.
 */

export const COOLDOWN_MIN_MINUTES = 0
export const COOLDOWN_MAX_MINUTES = 1440

/** Input validation failed. Safe to display on the settings form. */
export class NotificationSettingsValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotificationSettingsValidationError'
  }
}

export type NotificationSettingsInput = {
  notificationEmail: string | null
  discordWebhook: string | null
  emailOnOpen: boolean
  emailOnResolve: boolean
  alertCooldownMinutes: number
}

async function activeOrgUuid(): Promise<string> {
  const { client, orgId } = await createOrgScopedClient()
  const { data, error } = await client
    .from('organizations')
    .select('id')
    .eq('clerk_org_id', orgId)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new OrgNotSyncedError()
  return data.id
}

/**
 * The active org's settings row, or null before the first save. Admin only
 * by RLS; a member gets null, never an error.
 */
export async function getNotificationSettings(): Promise<OrgNotificationSettings | null> {
  const { client } = await createOrgScopedClient()
  const { data, error } = await client
    .from('org_notification_settings')
    .select()
    .maybeSingle()
  if (error) throw error
  return data
}

/**
 * Validates and saves the settings row for the active org, creating it on
 * the first save. A bad webhook URL or email is a form error, never a
 * silent drop. RLS makes this admin only; for anyone else the write matches
 * zero rows or is refused outright.
 */
export async function saveNotificationSettings(
  input: NotificationSettingsInput,
): Promise<void> {
  const email = input.notificationEmail?.trim() || null
  if (email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new NotificationSettingsValidationError(
      'That email address does not look right. Check it and save again.',
    )
  }

  let webhook: string | null = null
  if (input.discordWebhook && input.discordWebhook.trim() !== '') {
    webhook = normalizeDiscordWebhookUrl(input.discordWebhook)
    if (webhook === null) {
      throw new NotificationSettingsValidationError(
        'That is not a Discord webhook URL. Paste the https://discord.com/api/webhooks/… address from your channel settings.',
      )
    }
  }

  const cooldown = input.alertCooldownMinutes
  if (
    !Number.isInteger(cooldown) ||
    cooldown < COOLDOWN_MIN_MINUTES ||
    cooldown > COOLDOWN_MAX_MINUTES
  ) {
    throw new NotificationSettingsValidationError(
      `Cooldown must be a whole number of minutes between ${COOLDOWN_MIN_MINUTES} and ${COOLDOWN_MAX_MINUTES}.`,
    )
  }

  const orgUuid = await activeOrgUuid()
  const { client } = await createOrgScopedClient()

  const values = {
    notification_email: email,
    discord_webhook: webhook,
    email_on_open: input.emailOnOpen,
    email_on_resolve: input.emailOnResolve,
    alert_cooldown_minutes: cooldown,
  }

  // Select then write, the api-keys.ts shape: INSERT vs UPDATE is explicit so
  // each verb touches only the columns its grant allows (org_id is fixed at
  // birth and has no update grant). RLS refuses both for a non admin.
  const { data: existing, error: exErr } = await client
    .from('org_notification_settings')
    .select('org_id')
    .eq('org_id', orgUuid)
    .maybeSingle()
  if (exErr) throw exErr

  if (existing) {
    const { error } = await client
      .from('org_notification_settings')
      .update(values)
      .eq('org_id', orgUuid)
    if (error) throw error
  } else {
    const { error } = await client
      .from('org_notification_settings')
      .insert({ org_id: orgUuid, ...values })
    if (error) throw error
  }
}
