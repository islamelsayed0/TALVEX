import Link from 'next/link'
import { notFound } from 'next/navigation'

import { getTicket, getTicketViewer } from '@/lib/db/tickets'
import { ghostButton, primaryButton } from '../../../monitors/ui'
import { memberSetTicketStatusAction } from '../../actions'

export const metadata = { title: 'Cancel request — Talvext' }

/**
 * The confirmation for withdrawing your own request, its own page in the
 * monitors delete idiom, fully server side.
 *
 * Confirming matters here because cancel is terminal for the requester: there
 * is no member transition out of canceled, by ruling, so the honest thing is
 * to say that before they press it rather than after.
 *
 * The button uses the primary accent, not red. Red is reserved for status
 * meaning, and withdrawing a request is not something going wrong.
 */
export default async function CancelTicketPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [ticket, viewer] = await Promise.all([getTicket(id), getTicketViewer()])
  // RLS already decided whether this session may see the ticket at all. This
  // is the narrower question: cancel is the requester's action, so an admin
  // reaching this URL is sent to the status control they already have.
  if (!ticket) notFound()
  if (ticket.submitted_by !== viewer.userId) notFound()
  if (ticket.status !== 'open' && ticket.status !== 'in_progress') notFound()

  return (
    <main id="main-content" className="flex flex-1 flex-col gap-6 p-8">
      <div className="flex max-w-md flex-col gap-4 rounded-button border border-border bg-card p-6">
        <h1 className="text-title text-card-foreground">
          Cancel this request?
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Your IT team will see that you withdrew it, and it stops being
          something they need to answer. It stays on your list for a week so
          you can look back at it. If you need help with this again, start a
          new request.
        </p>
        <form
          action={memberSetTicketStatusAction}
          className="flex items-center gap-3"
        >
          <input type="hidden" name="id" value={ticket.id} />
          <input type="hidden" name="status" value="canceled" />
          <button type="submit" className={primaryButton}>
            Cancel this request
          </button>
          <Link href={`/dashboard/tickets/${ticket.id}`} className={ghostButton}>
            Keep it open
          </Link>
        </form>
      </div>
    </main>
  )
}
