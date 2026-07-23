import Link from 'next/link'

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

const STATUS_LABEL: Record<StatusKind, string> = {
  up: 'Up',
  down: 'Down',
  pending: 'Pending',
  paused: 'Paused',
}

const STATUS_TEXT: Record<StatusKind, string> = {
  up: 'text-status-up',
  down: 'text-status-down',
  pending: 'text-status-pending',
  paused: 'text-quiet',
}

const STATUS_DOT: Record<StatusKind, string> = {
  up: 'bg-status-up',
  down: 'bg-status-down',
  pending: 'bg-status-pending',
  paused: 'bg-quiet',
}

export function StatusBadge({ status }: { status: StatusKind }) {
  return (
    <span className={`inline-flex items-center gap-2 text-sm font-medium ${STATUS_TEXT[status]}`}>
      <span className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`} aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  )
}

export function formatMs(ms: number | null): string {
  return ms === null ? '—' : `${ms} ms`
}

export function formatUptime(percent: number | null): string {
  return percent === null ? '—' : `${percent.toFixed(2)}%`
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
  'h-12 w-full rounded-field border border-input bg-field px-4 text-sm text-field-text outline-none transition-colors placeholder:text-placeholder focus:border-(--ring) focus:bg-field-focus'

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
