import { StatusText, type StatusTone } from '@/components/status-mark'
import type { TicketStatus } from '@/lib/db/types'

/**
 * Shared server rendered pieces for the tickets screens. No client
 * components; every form posts to a server action.
 *
 * Status colors (Task 3 ruling): amber open, blue in progress, green
 * resolved. Amber and green come from the reserved --status-* tokens and keep
 * their status truth meaning (waiting, handled). In progress wears the accent
 * blue doing double duty, which the ruling accepts because blue carries no
 * up/down semantics. No new colors exist.
 *
 * Canceled inherits the muted neutral the retired closed state used, and that
 * is a deliberate reading rather than a leftover: a withdrawal is not a
 * failure. Red is reserved for something being wrong, and somebody deciding
 * they no longer need help is not something being wrong. Neutral says
 * finished, which is exactly what it is.
 */

export const STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
  canceled: 'Canceled',
}

/** Ticket state onto the shared mark tones. Open is waiting (ring), in
 * progress is the accent (square), resolved is recovered (circle), canceled is
 * neutral (bar). */
const STATUS_TONE: Record<TicketStatus, StatusTone> = {
  open: 'pending',
  in_progress: 'active',
  resolved: 'up',
  canceled: 'paused',
}

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  return (
    <StatusText
      tone={STATUS_TONE[status]}
      label={STATUS_LABEL[status]}
      size={8}
    />
  )
}

/**
 * The chip marking a comment as an internal note in the admin trail. Muted
 * styling plus the word, because colour alone is not a label: an admin
 * skimming needs to know at a glance which of these the requester can read,
 * and the answer has to survive being read quickly.
 */
export function InternalChip() {
  return (
    <span className="rounded-mini border border-divider px-1.5 py-0.5 text-[11px] font-medium tracking-wide text-quiet uppercase">
      Internal
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
