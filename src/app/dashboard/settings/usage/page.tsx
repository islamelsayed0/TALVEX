import Link from 'next/link'

import { requireAdmin } from '@/lib/auth/org-viewer'
import { AI_PROVIDER_LABELS } from '@/lib/chat/providers-meta'
import { listApiKeys } from '@/lib/db/api-keys'
import {
  getUsageOverview,
  supportedTimezones,
  type MonthUsage,
} from '@/lib/db/usage'

import { Card } from '../../_overview/ui'
import { primaryButton } from '../../monitors/ui'
import { FormError, ticketFieldClass } from '../../tickets/ui'
import { SettingsNav } from '../nav'
import { saveTimezoneAction } from './actions'
import { AutoTimezone } from './auto-timezone'

export const metadata = { title: 'Settings — Talvext' }

const n = (value: number) => value.toLocaleString('en-US')

/** Label + value line used by the seats section and the totals. */
function StatLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between border-t border-divider py-2.5 first:border-t-0">
      <span className="text-[13.5px] text-muted-foreground">{label}</span>
      <span className="font-mono text-[13.5px] font-medium text-foreground">
        {value}
      </span>
    </div>
  )
}

/** The 30 day check volume bar, the uptime strip idiom: one flex bar per UTC
 * day, height proportional to the day's check count. Server rendered, no
 * charting dependency. */
function CheckBars({ days }: { days: Array<{ day: string; count: number }> }) {
  const max = Math.max(...days.map((d) => d.count))
  if (max === 0) {
    return (
      <div className="flex h-[46px] items-center text-[12px] text-quiet">
        No checks recorded in the last 30 days.
      </div>
    )
  }
  return (
    <div className="flex h-[46px] items-end gap-[2px]" aria-hidden>
      {days.map((d) => (
        <span
          key={d.day}
          title={`${d.day}: ${n(d.count)} checks`}
          className={`min-w-0 flex-1 rounded-[1px] ${
            d.count > 0 ? 'bg-accent-text opacity-[.75]' : 'bg-quiet/30'
          }`}
          style={{ height: d.count > 0 ? `${Math.max(8, (d.count / max) * 100)}%` : '3px' }}
        />
      ))}
    </div>
  )
}

function AiUsageRows({ month }: { month: MonthUsage }) {
  return (
    <div className="mt-3">
      {month.providers.map((p) => (
        <div
          key={p.provider}
          className="flex items-baseline justify-between border-t border-divider py-2.5"
        >
          <span className="text-[13.5px] text-foreground">
            {AI_PROVIDER_LABELS[p.provider]}
          </span>
          <span className="font-mono text-[12.5px] text-muted-foreground">
            {n(p.messages)} messages · {n(p.inputTokens)} in / {n(p.outputTokens)}{' '}
            out tokens
          </span>
        </div>
      ))}
      <div className="flex items-baseline justify-between border-t border-divider py-2.5">
        <span className="text-[13.5px] font-medium text-foreground">
          Month total
        </span>
        <span className="font-mono text-[12.5px] font-medium text-foreground">
          {n(month.messageCount)} messages · {n(month.inputTokens)} in /{' '}
          {n(month.outputTokens)} out tokens
        </span>
      </div>
    </div>
  )
}

/**
 * Usage (F11), display only: what this org used, counted from the tables the
 * product already writes, shown to admins. No plans, no limits, no billing;
 * enforcement is a Phase 2 concern layered on these same numbers. Admin only
 * exactly like the other settings tabs (requireAdmin), and the data layer
 * runs under the caller's own RLS besides.
 */
export default async function UsageSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const asString = (v: string | string[] | undefined) =>
    typeof v === 'string' ? v : ''

  await requireAdmin()

  const [usage, keys] = await Promise.all([getUsageOverview(), listApiKeys()])
  const saved = asString(sp.saved) === '1'
  const error = asString(sp.error)

  const current = usage.currentMonth
  const previous = usage.previousMonth
  const aiIsEmpty = current.messageCount === 0 && previous.messageCount === 0
  const zones = supportedTimezones()
  const zoneOptions = zones.includes(usage.timezone)
    ? zones
    : [usage.timezone, ...zones]

  return (
    <main id="main-content" className="mx-auto w-full max-w-[780px] flex-1 animate-fade-up px-8 pt-[30px] pb-[72px]">
      <AutoTimezone zoneIsSet={usage.timezoneStored} />

      <div className="mb-[22px]">
        <h1 className="text-title text-foreground">Settings</h1>
        <p className="mt-1.5 text-[14px] text-quiet">
          Manage your workspace, team and integrations.
        </p>
      </div>

      <SettingsNav />

      {saved ? (
        <Card className="mb-[18px] px-5 py-4 text-sm text-card-foreground">
          Saved. Usage months follow the new timezone from now on.
        </Card>
      ) : null}

      {/* AI usage: this org month and the previous one, from chat_messages. */}
      <Card className="px-[22px] py-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-base font-semibold text-foreground">
            This month — {current.label}
          </h2>
          <span className="font-mono text-[12px] text-quiet">
            {usage.timezone}
            {usage.timezoneStored ? '' : ' (detected)'}
          </span>
        </div>
        <p className="mt-1 text-[12.5px] text-quiet">
          AI support chat messages and tokens, counted per provider.
        </p>

        {aiIsEmpty ? (
          <p className="mt-4 border-t border-divider pt-4 text-[13px] text-quiet">
            No AI messages yet.{' '}
            {keys.length === 0 ? (
              <>
                Chat needs a provider key first — add one under{' '}
                <Link
                  href="/dashboard/settings/api-keys"
                  className="font-medium text-accent-text"
                >
                  AI providers
                </Link>
                .
              </>
            ) : (
              'Messages will show up here as your team uses the chat.'
            )}
          </p>
        ) : (
          <>
            <AiUsageRows month={current} />
            {previous.messageCount > 0 ? (
              <p className="mt-3 text-[12px] text-quiet">
                {previous.label}: {n(previous.messageCount)} messages ·{' '}
                {n(previous.inputTokens)} in / {n(previous.outputTokens)} out
                tokens.
              </p>
            ) : null}
          </>
        )}
      </Card>

      {/* Monitor checks, from the daily rollups the cron sweep maintains. */}
      <Card className="mt-[18px] px-[22px] py-5">
        <h2 className="text-base font-semibold text-foreground">
          Monitor checks
        </h2>
        <p className="mt-1 text-[12.5px] text-quiet">
          Checks executed across all monitors. Days are UTC day buckets, so
          month edges can differ from your timezone by a few hours.
        </p>
        <div className="mt-4">
          <CheckBars days={usage.checks.days} />
          <div className="mt-1 flex justify-between text-[11px] text-quiet">
            <span>30 days ago</span>
            <span>today</span>
          </div>
        </div>
        <div className="mt-3">
          <StatLine
            label={`${current.label} total (UTC days)`}
            value={`${n(usage.checks.monthTotal)} checks`}
          />
          <StatLine
            label="Last 30 days"
            value={`${n(usage.checks.last30DaysTotal)} checks`}
          />
        </div>
      </Card>

      {/* Seats: a live count from org_members at render time. */}
      <Card className="mt-[18px] px-[22px] py-5">
        <h2 className="text-base font-semibold text-foreground">Seats</h2>
        <div className="mt-3">
          <StatLine label="Admins" value={n(usage.seats.admins)} />
          <StatLine label="Members" value={n(usage.seats.members)} />
          <StatLine label="Total" value={n(usage.seats.total)} />
        </div>
      </Card>

      {/* The org timezone: one authoritative zone, admin editable. */}
      <Card className="mt-[18px] px-[22px] py-5">
        <h2 className="text-base font-semibold text-foreground">
          Usage timezone
        </h2>
        <p className="mt-1 text-[12.5px] text-quiet">
          Usage months follow this timezone. Everyone in the organization sees
          the same numbers.
        </p>
        <form action={saveTimezoneAction} className="mt-4 flex flex-col gap-3">
          <FormError message={error || undefined} />
          <div className="flex items-end gap-3">
            <label className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="text-[12.5px] text-muted-foreground">
                Timezone
              </span>
              <select
                name="timezone"
                defaultValue={usage.timezone}
                className={`${ticketFieldClass} h-11`}
              >
                {zoneOptions.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone === usage.timezone && !usage.timezoneStored
                      ? `${zone} (detected)`
                      : zone}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className={`${primaryButton} flex-none`}>
              Save timezone
            </button>
          </div>
        </form>
      </Card>

      <p className="mt-[18px] text-[12px] text-quiet">
        Usage is shown for information; nothing is limited or billed.
      </p>
    </main>
  )
}
