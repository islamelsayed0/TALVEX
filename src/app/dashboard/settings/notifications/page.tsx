import { requireAdmin } from '@/lib/auth/org-viewer'
import {
  COOLDOWN_MAX_MINUTES,
  COOLDOWN_MIN_MINUTES,
  DEFAULT_DIGEST_SEND_TIME,
  getNotificationSettings,
} from '@/lib/db/notification-settings'
import { getOrgTimezone } from '@/lib/db/usage'

import { Card } from '../../_overview/ui'
import { ghostButton, primaryButton } from '../../monitors/ui'
import { FormError, ticketFieldClass } from '../../tickets/ui'
import { SettingsNav } from '../nav'
import {
  saveDigestSettingsAction,
  saveNotificationSettingsAction,
  sendTestNotificationAction,
} from './actions'

export const metadata = { title: 'Settings — Talvex' }

/**
 * Notification settings (F10), admin only exactly like api-keys: same
 * requireAdmin gate, same layout and primitives. One form, one settings row
 * per org: where alert emails go, the Discord webhook, the two email
 * toggles, and the reopen cooldown. The webhook URL is validated server
 * side before it saves; a bad URL comes back as a form error.
 */
export default async function NotificationSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const asString = (v: string | string[] | undefined) =>
    typeof v === 'string' ? v : ''

  await requireAdmin()

  const [settings, org] = await Promise.all([
    getNotificationSettings(),
    getOrgTimezone(),
  ])

  const savedParam = asString(sp.saved)
  const saved = savedParam === '1'
  const savedDigest = savedParam === 'digest'
  const error = asString(sp.error)
  const tested = asString(sp.tested)
  const hasChannel = Boolean(
    settings?.notification_email || settings?.discord_webhook,
  )
  // The column is a SQL time, so PostgREST returns 'HH:MM:SS'; the input
  // offers 'HH:MM' and the database refuses a seconds component anyway.
  const digestTime = (settings?.digest_send_time ?? DEFAULT_DIGEST_SEND_TIME).slice(0, 5)

  return (
    <main id="main-content" className="mx-auto w-full max-w-[780px] flex-1 animate-fade-up px-8 pt-[30px] pb-[72px]">
      <div className="mb-[22px]">
        <h1 className="text-title text-foreground">Settings</h1>
        <p className="mt-1.5 text-[14px] text-quiet">
          Manage your workspace, team and integrations.
        </p>
      </div>

      <SettingsNav />

      {saved ? (
        <Card className="mb-[18px] px-5 py-4 text-sm text-card-foreground">
          Saved. Alerts will use these settings from the next check.
        </Card>
      ) : null}

      {savedDigest ? (
        <Card className="mb-[18px] px-5 py-4 text-sm text-card-foreground">
          Saved. Your digest settings take effect from tomorrow morning.
        </Card>
      ) : null}

      {tested ? (
        <Card className="mb-[18px] px-5 py-4 text-sm text-card-foreground">
          {tested === 'none'
            ? 'Add a channel and save it first, then send a test.'
            : `Test result — ${tested}`}
        </Card>
      ) : null}

      <Card className="px-[22px] py-5">
        <h2 className="text-base font-semibold text-foreground">Notifications</h2>
        <p className="mt-1 text-[12.5px] text-quiet">
          When a monitor goes down or recovers, Talvex tells you here. Included
          on every plan.
        </p>

        <form
          action={saveNotificationSettingsAction}
          className="mt-5 flex flex-col gap-4"
          autoComplete="off"
        >
          <FormError message={error || undefined} />

          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] text-muted-foreground">
              Notification email
            </span>
            <input
              name="notification_email"
              type="email"
              defaultValue={settings?.notification_email ?? ''}
              placeholder="alerts@yourcompany.com"
              className={`${ticketFieldClass} h-11`}
            />
            <span className="text-[12px] text-quiet">
              Leave empty to turn email alerts off.
            </span>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] text-muted-foreground">
              Discord webhook URL
            </span>
            <input
              name="discord_webhook"
              type="url"
              defaultValue={settings?.discord_webhook ?? ''}
              placeholder="https://discord.com/api/webhooks/…"
              className={`${ticketFieldClass} h-11`}
            />
            <span className="text-[12px] text-quiet">
              From your channel settings under Integrations. Leave empty to turn
              Discord alerts off.
            </span>
          </label>

          <div className="flex flex-col gap-2.5 border-t border-divider pt-4">
            <label className="flex items-center gap-2.5 text-sm text-foreground">
              <input
                name="email_on_open"
                type="checkbox"
                defaultChecked={settings?.email_on_open ?? true}
                className="h-4 w-4 accent-(--status-up)"
              />
              Email me when a monitor goes down
            </label>
            <label className="flex items-center gap-2.5 text-sm text-foreground">
              <input
                name="email_on_resolve"
                type="checkbox"
                defaultChecked={settings?.email_on_resolve ?? true}
                className="h-4 w-4 accent-(--status-up)"
              />
              Email me when it recovers
            </label>
          </div>

          <label className="flex flex-col gap-1.5 border-t border-divider pt-4">
            <span className="text-[12.5px] text-muted-foreground">
              Alert cooldown, in minutes
            </span>
            <input
              name="alert_cooldown_minutes"
              type="number"
              min={COOLDOWN_MIN_MINUTES}
              max={COOLDOWN_MAX_MINUTES}
              step={1}
              required
              defaultValue={settings?.alert_cooldown_minutes ?? 30}
              className={`${ticketFieldClass} h-11 max-w-[160px]`}
            />
            <span className="text-[12px] text-quiet">
              If a monitor goes down again within this window of the last alert,
              Talvex stays quiet instead of alerting twice.
            </span>
          </label>

          <div>
            <button type="submit" className={primaryButton}>
              Save notification settings
            </button>
          </div>
        </form>

        {/* Test send. Its own form (forms cannot nest) and it uses the SAVED
            channels, so save any changes first. */}
        <div className="mt-6 border-t border-divider pt-5">
          <span className="text-[13.5px] font-medium text-foreground">
            Send a test
          </span>
          <p className="mt-1 text-[12px] text-quiet">
            Sends a test alert to your saved channels, so you can confirm they
            work without waiting for a real incident. Save any changes first.
          </p>
          <form action={sendTestNotificationAction} className="mt-3">
            <button type="submit" className={ghostButton} disabled={!hasChannel}>
              Send a test
            </button>
          </form>
          {!hasChannel ? (
            <p className="mt-2 text-[12px] text-quiet">
              Add an email or Discord webhook above and save to enable this.
            </p>
          ) : null}
        </div>
      </Card>

      {/* The daily digest. Its own card and its own form: it saves
          independently of the alert channels above, and the copy has to carry
          three promises plainly, so it needs the room. */}
      <Card className="mt-[18px] px-[22px] py-5">
        <h2 className="text-base font-semibold text-foreground">Daily digest</h2>
        <p className="mt-1 text-[12.5px] text-quiet">
          One email each morning with what needs attention: open incidents,
          tickets waiting on a reply, tickets that arrived overnight, and
          anything low on stock. Titles, counts and links only, never the
          contents of a ticket.
        </p>

        <form
          action={saveDigestSettingsAction}
          className="mt-5 flex flex-col gap-4"
          autoComplete="off"
        >
          <label className="flex items-center gap-2.5 text-sm text-foreground">
            <input
              name="digest_enabled"
              type="checkbox"
              defaultChecked={settings?.digest_enabled ?? false}
              className="h-4 w-4 accent-(--status-up)"
            />
            Send me the daily digest
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] text-muted-foreground">Send time</span>
            <input
              name="digest_send_time"
              type="time"
              required
              defaultValue={digestTime}
              className={`${ticketFieldClass} h-11 max-w-[160px]`}
            />
            <span className="text-[12px] text-quiet">
              Around this time in your organization&rsquo;s timezone,{' '}
              {org.timezone}. Talvex checks every few minutes, so the email
              arrives at your chosen time or a few minutes after.
            </span>
          </label>

          <p className="border-t border-divider pt-4 text-[12px] text-quiet">
            If there is nothing that needs you, there is no email. Talvex does
            not send an all clear. An email arriving means something is waiting.
          </p>

          <p className="text-[12px] text-quiet">
            It goes to the notification email above. Set one first, or the
            digest has nowhere to go.
          </p>

          <div>
            <button type="submit" className={primaryButton}>
              Save digest settings
            </button>
          </div>
        </form>
      </Card>
    </main>
  )
}
