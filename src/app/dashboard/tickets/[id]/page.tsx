import Link from 'next/link'
import { notFound } from 'next/navigation'

import { UNKNOWN_MEMBER, resolveUserNames } from '@/lib/auth/user-names'
import {
  getTicket,
  getTicketViewer,
  interleaveTrail,
  listTicketComments,
  listTicketEvents,
  TICKET_STATUSES,
} from '@/lib/db/tickets'
import type { TicketStatus } from '@/lib/db/types'
import { formatUtc, ghostButton, primaryButton } from '../../monitors/ui'
import { addTicketCommentAction, updateTicketStatusAction } from '../actions'
import { FormError, STATUS_LABEL, TicketStatusBadge, ticketFieldClass } from '../ui'

export const metadata = { title: 'Ticket — Talvex' }

/**
 * Ticket detail: the request, then everything that happened to it, in
 * order. Comments are user content and system events are the trail; they
 * are stored apart and rendered interleaved (Task 3 ruling 5). A ticket id
 * this session cannot see 404s exactly like one that does not exist: RLS
 * returns no row either way, whether the reason is another org or another
 * member's ticket.
 *
 * The status control renders for admins only, but that is presentation:
 * RLS is what makes a non admin status change match zero rows.
 */
export default async function TicketDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams
  const asString = (v: string | string[] | undefined) =>
    typeof v === 'string' ? v : ''

  const ticket = await getTicket(id)
  if (!ticket) notFound()

  const [viewer, comments, events] = await Promise.all([
    getTicketViewer(),
    listTicketComments(ticket.id),
    listTicketEvents(ticket.id),
  ])
  const names = await resolveUserNames([
    ticket.submitted_by,
    ...comments.map((c) => c.author),
    ...events.map((e) => e.actor),
  ])
  const nameOf = (userId: string | null) =>
    userId === null ? 'Talvex' : (names.get(userId) ?? UNKNOWN_MEMBER)

  const trail = interleaveTrail(comments, events)
  const status = ticket.status as TicketStatus
  const closed = status === 'closed'

  return (
    <main className="flex flex-1 flex-col gap-6 p-8">
      <div>
        <Link
          href="/dashboard/tickets"
          className="text-xs text-link hover:text-foreground"
        >
          ← All tickets
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-4">
          <h1 className="text-title text-foreground">{ticket.title}</h1>
          <TicketStatusBadge status={status} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Submitted by {nameOf(ticket.submitted_by)} on{' '}
          {formatUtc(ticket.created_at)}
        </p>
      </div>

      {asString(sp.submitted) ? (
        <p className="max-w-2xl rounded-button border border-border bg-card px-5 py-4 text-sm text-card-foreground">
          Your request is in. The team has it from here, and anything that
          happens shows up below.
        </p>
      ) : null}

      <section className="max-w-2xl rounded-button border border-border bg-card p-6">
        <h2 className="text-xs text-quiet">The request</h2>
        <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap text-card-foreground">
          {ticket.description}
        </p>
      </section>

      {viewer.isAdmin && !closed ? (
        <StatusControl ticketId={ticket.id} current={status} />
      ) : null}

      <section className="max-w-2xl">
        <h2 className="text-base font-semibold text-foreground">Activity</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Comments and the system trail, oldest first. Times are UTC.
        </p>

        <ol className="mt-4 flex flex-col gap-3">
          {trail.map((item) =>
            item.kind === 'comment' ? (
              <li
                key={`comment-${item.comment.id}`}
                className="rounded-button border border-border bg-card p-5"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <span className="text-sm font-medium text-card-foreground">
                    {nameOf(item.comment.author)}
                  </span>
                  <span className="text-xs text-quiet">
                    {formatUtc(item.comment.created_at)}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap text-card-foreground">
                  {item.comment.body}
                </p>
              </li>
            ) : (
              <li
                key={`event-${item.event.id}`}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-2 py-1"
              >
                <span className="text-sm text-muted-foreground">
                  {item.event.detail ?? item.event.event_type}
                </span>
                <span className="text-xs text-quiet">
                  {nameOf(item.event.actor)}, {formatUtc(item.event.occurred_at)}
                </span>
              </li>
            ),
          )}
        </ol>

        {closed ? (
          <p className="mt-5 text-sm text-muted-foreground">
            This ticket is closed. It stays here for reference, and it does
            not take new comments.
          </p>
        ) : (
          <form
            action={addTicketCommentAction}
            className="mt-5 flex flex-col gap-3"
          >
            <input type="hidden" name="id" value={ticket.id} />
            <FormError message={asString(sp.error) || undefined} />
            <label className="flex flex-col gap-1.5">
              <span className="text-sm text-muted-foreground">Add a comment</span>
              <textarea
                name="body"
                required
                rows={3}
                maxLength={10000}
                defaultValue={asString(sp.body)}
                placeholder="Anything new, or anything we should know?"
                className={`${ticketFieldClass} resize-y py-3 leading-relaxed`}
              />
            </label>
            <div>
              <button type="submit" className={ghostButton}>
                Add comment
              </button>
            </div>
          </form>
        )}
      </section>
    </main>
  )
}

/**
 * Admin only status control. Closed is offered too: that is the manual
 * close path; once taken, the lifecycle is final and this control no longer
 * renders.
 */
function StatusControl({
  ticketId,
  current,
}: {
  ticketId: string
  current: TicketStatus
}) {
  return (
    <form
      action={updateTicketStatusAction}
      className="flex max-w-2xl flex-wrap items-center gap-3 rounded-button border border-border bg-card px-5 py-4"
    >
      <input type="hidden" name="id" value={ticketId} />
      <label className="flex items-center gap-3 text-sm text-muted-foreground">
        Status
        <select
          name="status"
          defaultValue={current}
          className={`${ticketFieldClass} h-10 w-auto appearance-none pr-8`}
        >
          {TICKET_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className={`${primaryButton} px-3 py-2`}>
        Update status
      </button>
      <p className="w-full text-xs text-quiet sm:w-auto">
        Resolved closes on its own after 7 days. Closed is final.
      </p>
    </form>
  )
}
