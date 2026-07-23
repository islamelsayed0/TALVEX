import type { IncidentEventType } from '@/lib/db/types'

/**
 * Shared server rendered pieces for the incidents screens. Same rules as
 * the monitors UI: no client components, and green/red appear only as
 * status meaning through the reserved --status-* tokens. An open incident
 * is a down state (red); a resolved one is recovered (green).
 */

export function IncidentBadge({ status }: { status: 'open' | 'resolved' }) {
  const open = status === 'open'
  return (
    <span
      className={`inline-flex items-center gap-2 text-sm font-medium ${
        open ? 'text-status-down' : 'text-status-up'
      }`}
    >
      <span
        className={`h-2 w-2 rounded-full ${open ? 'bg-status-down' : 'bg-status-up'}`}
        aria-hidden
      />
      {open ? 'Open' : 'Resolved'}
    </span>
  )
}

/** "4m", "1h 12m", "2d 4h". Floors to the two largest useful units. */
export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'under a minute'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}

/** Elapsed time since an open incident began, as of this server render. */
export function elapsedSince(openedAt: string): string {
  return formatDuration(Date.now() - Date.parse(openedAt))
}

/** Duration cell for a list row: elapsed so far for open, total for resolved. */
export function incidentDuration(incident: {
  status: string
  opened_at: string
  resolved_at: string | null
}): string {
  if (incident.status === 'open' || incident.resolved_at === null) {
    return `${elapsedSince(incident.opened_at)}, ongoing`
  }
  return formatDuration(
    Date.parse(incident.resolved_at) - Date.parse(incident.opened_at),
  )
}

/**
 * How each system event reads on the timeline. Calm, plain language per the
 * design brief; the ruling names the reopen event "down again".
 */
export const EVENT_COPY: Record<
  IncidentEventType,
  { label: string; tone: 'down' | 'up' }
> = {
  opened: { label: 'Incident opened', tone: 'down' },
  reopened: { label: 'Down again', tone: 'down' },
  recovered: { label: 'Monitor recovered', tone: 'up' },
  resolved: { label: 'Incident resolved', tone: 'up' },
}
