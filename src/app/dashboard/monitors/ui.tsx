import Link from 'next/link'

import { StatusText } from '@/components/status-mark'
import { certBand, certDaysLeft } from '@/lib/monitoring/cert-alerts'
import type { Monitor } from '@/lib/db/types'

/**
 * Shared server rendered pieces for the monitors screens. No client
 * components here: every form posts to a server action and every state
 * round trips through the URL.
 *
 * Color rule: green, amber, and red appear here and only here as status
 * meaning (the reserved --status-* tokens). A paused monitor is not a
 * status, so it stays neutral.
 */

export type StatusKind = 'up' | 'down' | 'pending' | 'paused'

export function monitorStatus(
  monitor: Pick<Monitor, 'active' | 'last_status'>,
): StatusKind {
  if (!monitor.active) return 'paused'
  if (monitor.last_status === 'up' || monitor.last_status === 'down') {
    return monitor.last_status
  }
  return 'pending'
}

export const STATUS_LABEL: Record<StatusKind, string> = {
  up: 'Up',
  down: 'Down',
  pending: 'Pending',
  paused: 'Paused',
}

export const STATUS_TEXT: Record<StatusKind, string> = {
  up: 'text-status-up',
  down: 'text-status-down',
  pending: 'text-status-pending',
  paused: 'text-quiet',
}

export function StatusBadge({ status }: { status: StatusKind }) {
  // The label was always here, so this was never color alone. What it lacked
  // was a second visual channel: four states drawn as the same circle meant
  // the mark itself said nothing. StatusText gives each one its own shape.
  return <StatusText tone={status} label={STATUS_LABEL[status]} size={8} />
}

/** "in 12 days", "in 1 day", "today", "expired 3 days ago". */
export function certWhen(daysLeft: number): string {
  if (daysLeft > 1) return `in ${daysLeft} days`
  if (daysLeft === 1) return 'in 1 day'
  if (daysLeft === 0) return 'today'
  const ago = -daysLeft
  return `expired ${ago} ${ago === 1 ? 'day' : 'days'} ago`
}

/**
 * The certificate warning chip for a monitor row. Renders nothing when the
 * certificate is healthy or unread: absence of warning IS the healthy state,
 * so a chip only ever means attention. Existing tones, no new silhouette: the
 * amber hollow ring already means "pending attention" and the red diamond
 * already means "down"; the label carries the certificate meaning, which is
 * what keeps this inside the no color alone rule.
 */
export function CertChip({
  certExpiresAt,
  nowMs,
  timeZone,
}: {
  certExpiresAt: string | null
  nowMs: number
  timeZone: string
}) {
  const band = certBand(certExpiresAt, nowMs, timeZone)
  if (band === null) return null
  if (band === 'expired') {
    return (
      <StatusText tone="down" label="Cert expired" size={7} className="text-xs font-medium" />
    )
  }
  const daysLeft = certDaysLeft(certExpiresAt!, nowMs, timeZone)
  const label =
    daysLeft === 0 ? 'Cert expires today' : `Cert expires ${certWhen(daysLeft)}`
  return <StatusText tone="pending" label={label} size={7} className="text-xs font-medium" />
}

export function formatMs(ms: number | null): string {
  return ms === null ? '—' : `${ms} ms`
}

export function formatUptime(percent: number | null): string {
  return percent === null ? '—' : `${percent.toFixed(2)}%`
}

/** The check cadence in words: "every 5 min", "every 1 hour". */
export function formatInterval(seconds: number): string {
  if (seconds % 3600 === 0) {
    const hours = seconds / 3600
    return `every ${hours} ${hours === 1 ? 'hour' : 'hours'}`
  }
  return `every ${Math.round(seconds / 60)} min`
}

/** Server rendered timestamps stay in UTC so output never depends on the
 * server's locale or timezone (and can never mismatch a future hydration). */
export function formatUtc(iso: string): string {
  const d = new Date(iso)
  const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${month} ${d.getUTCDate()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
}

export const primaryButton =
  'inline-flex items-center justify-center rounded-button bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover'

export const ghostButton =
  'inline-flex items-center justify-center rounded-button border border-(--ghost-border) px-4 py-2.5 text-sm font-semibold text-ghost-text transition-colors hover:border-(--ghost-border-hover) hover:bg-(--ghost-hover-bg)'

const fieldClass =
  'h-12 w-full rounded-field border border-input bg-field px-4 text-sm text-field-text transition-colors placeholder:text-placeholder focus:border-(--ring) focus:bg-field-focus'

const INTERVAL_OPTIONS = [
  { seconds: 300, label: 'Every 5 minutes' },
  { seconds: 600, label: 'Every 10 minutes' },
  { seconds: 900, label: 'Every 15 minutes' },
  { seconds: 1800, label: 'Every 30 minutes' },
  { seconds: 3600, label: 'Every hour' },
]

export type MonitorFormDefaults = {
  name: string
  url: string
  intervalSeconds: number
  active?: boolean
}

/**
 * The add and edit form. `error` and the defaults come from query params on
 * a failed submit, so the user's input survives the round trip.
 */
export function MonitorForm({
  action,
  submitLabel,
  cancelHref,
  defaults,
  showActive = false,
  monitorId,
  error,
}: {
  action: (formData: FormData) => Promise<void>
  submitLabel: string
  cancelHref: string
  defaults: MonitorFormDefaults
  showActive?: boolean
  monitorId?: string
  error?: string
}) {
  return (
    <form action={action} className="flex w-full max-w-md flex-col gap-5">
      {monitorId ? <input type="hidden" name="id" value={monitorId} /> : null}

      {error ? (
        <p role="alert" className="rounded-field border border-(--status-down) px-4 py-3 text-sm text-status-down">
          {error}
        </p>
      ) : null}

      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-muted-foreground">Name</span>
        <input
          name="name"
          type="text"
          required
          maxLength={120}
          defaultValue={defaults.name}
          placeholder="Marketing site"
          className={fieldClass}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-muted-foreground">URL</span>
        <input
          name="url"
          type="url"
          required
          defaultValue={defaults.url}
          placeholder="https://example.com"
          className={fieldClass}
        />
        <span className="text-xs text-quiet">
          http or https. We check it with a simple GET request.
        </span>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-muted-foreground">Check interval</span>
        <select
          name="interval"
          defaultValue={String(defaults.intervalSeconds)}
          className={`${fieldClass} appearance-none`}
        >
          {INTERVAL_OPTIONS.map((opt) => (
            <option key={opt.seconds} value={opt.seconds}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      {showActive ? (
        <label className="flex items-center gap-2.5 text-sm text-muted-foreground">
          <input
            name="active"
            type="checkbox"
            defaultChecked={defaults.active ?? true}
            className="h-4 w-4 accent-(--primary)"
          />
          Active. Uncheck to pause checks without losing history.
        </label>
      ) : null}

      <div className="mt-1 flex items-center gap-3">
        <button type="submit" className={primaryButton}>
          {submitLabel}
        </button>
        <Link href={cancelHref} className={ghostButton}>
          Cancel
        </Link>
      </div>
    </form>
  )
}
