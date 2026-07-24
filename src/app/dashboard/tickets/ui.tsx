import type { TicketStatus } from '@/lib/db/types'

/**
 * Shared server rendered pieces for the tickets screens. No client
 * components; every form posts to a server action.
 *
 * Status colors (Task 3 ruling): amber open, blue in progress, green
 * resolved, neutral closed. Amber and green come from the reserved
 * --status-* tokens and keep their status truth meaning (waiting, handled).
 * In progress wears the accent blue doing double duty, which the ruling
 * accepts because blue carries no up/down semantics. No new colors exist.
 */

export const STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
  closed: 'Closed',
}

const STATUS_TEXT: Record<TicketStatus, string> = {
  open: 'text-status-pending',
  in_progress: 'text-accent-text',
  resolved: 'text-status-up',
  closed: 'text-quiet',
}

const STATUS_DOT: Record<TicketStatus, string> = {
  open: 'bg-status-pending',
  in_progress: 'bg-(--accent-text)',
  resolved: 'bg-status-up',
  closed: 'bg-quiet',
}

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-2 text-sm font-medium ${STATUS_TEXT[status]}`}
    >
      <span className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`} aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  )
}

export const ticketFieldClass =
  'w-full rounded-field border border-input bg-field px-4 text-sm text-field-text outline-none transition-colors placeholder:text-placeholder focus:border-(--ring) focus:bg-field-focus'

export function FormError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <p
      role="alert"
      className="rounded-field border border-(--status-down) px-4 py-3 text-sm text-status-down"
    >
      {message}
    </p>
  )
}
