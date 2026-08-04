import Link from 'next/link'
import { notFound } from 'next/navigation'

import { UNKNOWN_MEMBER, resolveUserNames } from '@/lib/auth/user-names'
import { getConversation } from '@/lib/db/chat'
import { getIncident } from '@/lib/db/incidents'
import {
  getTicket,
  getTicketViewer,
  interleaveTrail,
  listTicketComments,
  isTerminalTicketStatus,
  listTicketEvents,
  TICKET_STATUSES,
} from '@/lib/db/tickets'
import type { TicketStatus } from '@/lib/db/types'
import { formatUtc, ghostButton, primaryButton } from '../../monitors/ui'
import { IncidentBadge } from '../../incidents/ui'
import {
  addTicketCommentAction,
  adminCloseTicketAction,
  memberHideTicketAction,
  memberSetTicketStatusAction,
  updateTicketStatusAction,
} from '../actions'
import {
  FormError,
  InternalChip,
  STATUS_LABEL,
  TicketStatusBadge,
  ticketFieldClass,
} from '../ui'

export const metadata = { title: 'Ticket — Talvext' }

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
    userId === null ? 'Talvext' : (names.get(userId) ?? UNKNOWN_MEMBER)

  // The incident this ticket was created from, if any (Task 4). Status is read
  // live from the incidents table on every render, so the card reflects the
  // incident's current state; the two lifecycles stay independent and neither
  // one drives the other.
  const incident = ticket.incident_id
    ? await getIncident(ticket.incident_id)
    : null

  // The chat conversation this ticket was escalated from, if any (Task 5). The
  // card links through to the full transcript, which the AI summary in the
  // ticket body condenses; admins can read conversations, the submitter reads
  // their own. Null when the conversation was since removed.
  const conversation = ticket.conversation_id
    ? await getConversation(ticket.conversation_id)
    : null

  const trail = interleaveTrail(comments, events)
  const status = ticket.status as TicketStatus
  // The requester's own view of their own ticket. Admins get the admin
  // controls instead, even on a ticket they submitted, so every screen keeps
  // one obvious set of actions rather than two overlapping ones.
  const isRequester = !viewer.isAdmin && ticket.submitted_by === viewer.userId
  const settled = isTerminalTicketStatus(status)

  return (
    <main id="main-content" className="flex flex-1 flex-col gap-6 p-8">
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

      {incident ? (
        <Link
          href={`/dashboard/incidents/${incident.id}`}
          className="flex max-w-2xl flex-wrap items-center justify-between gap-3 rounded-button border border-border bg-card px-5 py-4 transition-colors hover:border-(--ghost-border-hover)"
        >
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-quiet">From incident</span>
            <span className="text-sm font-medium text-card-foreground">
              {incident.monitorName}
            </span>
            <span className="text-xs text-quiet">
              Opened {formatUtc(incident.opened_at)}
            </span>
          </div>
          <IncidentBadge status={incident.status === 'open' ? 'open' : 'resolved'} />
        </Link>
      ) : null}

      {conversation ? (
        <Link
          href={`/dashboard/chat/${conversation.id}`}
          className="flex max-w-2xl flex-wrap items-center justify-between gap-3 rounded-button border border-border bg-card px-5 py-4 transition-colors hover:border-(--ghost-border-hover)"
        >
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-quiet">From chat</span>
            <span className="text-sm font-medium text-card-foreground">
              {conversation.title}
            </span>
            <span className="text-xs text-quiet">View the full conversation</span>
          </div>
          <span className="text-sm text-accent-text">Open →</span>
        </Link>
      ) : null}

      {viewer.isAdmin ? (
        <>
          {!settled ? <AdminCloseDialog ticketId={ticket.id} sp={sp} /> : null}
          <StatusControl ticketId={ticket.id} current={status} />
        </>
      ) : null}

      {isRequester ? (
        <RequesterActions ticketId={ticket.id} status={status} sp={sp} />
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
                className={
                  item.comment.is_internal
                    ? 'rounded-button border border-dashed border-divider bg-tile p-5'
                    : 'rounded-button border border-border bg-card p-5'
                }
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <span className="text-sm font-medium text-card-foreground">
                    {nameOf(item.comment.author)}
                  </span>
                  <span className="text-xs text-quiet">
                    {formatUtc(item.comment.created_at)}
                  </span>
                  {/* Only an admin can ever see one of these: the select
                      policy withholds internal rows from every member session,
                      so this branch is unreachable for a requester rather than
                      merely unrendered. */}
                  {item.comment.is_internal ? <InternalChip /> : null}
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
                  {/* The created_from_incident detail carries the raw incident
                      id for the record; the reference card above is the human
                      link, so the trail reads plainly here. */}
                  {item.event.event_type === 'created_from_incident'
                    ? 'Created from an incident'
                    : item.event.event_type === 'created_from_chat'
                      ? 'Created from a chat'
                      : (item.event.detail ?? item.event.event_type)}
                </span>
                <span className="text-xs text-quiet">
                  {nameOf(item.event.actor)}, {formatUtc(item.event.occurred_at)}
                </span>
              </li>
            ),
          )}
        </ol>

        {/* Every state takes comments now. The old gate was "not closed", and
            closed is gone; a settled ticket somebody wants to add one more
            thing to is not a problem worth refusing. */}
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
          {viewer.isAdmin ? (
            <label className="flex items-center gap-2.5 text-sm text-muted-foreground">
              <input type="checkbox" name="is_internal" className="size-4" />
              Internal note, not shown to the person who asked
            </label>
          ) : null}
          <div>
            <button type="submit" className={ghostButton}>
              Add comment
            </button>
          </div>
        </form>
      </section>
    </main>
  )
}

/**
 * Admin only status control, unchanged in what it can reach: every status,
 * including Canceled, in either direction. Nothing is final now, so this
 * renders in every state rather than disappearing on the last one.
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
        Nothing here is permanent. Any of these can be changed again.
      </p>
    </form>
  )
}

/**
 * The admin close dialog: a message the requester will read, a note only
 * admins will, and one button that resolves the ticket. Both boxes are
 * optional, so this is also just a Resolve button for anyone who has nothing
 * to say.
 *
 * A `details` element rather than a client component, because the whole
 * tickets surface is server rendered and one disclosure is not a reason to
 * ship JavaScript.
 */
function AdminCloseDialog({
  ticketId,
  sp,
}: {
  ticketId: string
  sp: Record<string, string | string[] | undefined>
}) {
  const asString = (v: string | string[] | undefined) =>
    typeof v === 'string' ? v : ''
  return (
    <details
      className="max-w-2xl rounded-button border border-border bg-card px-5 py-4"
      open={Boolean(asString(sp.message) || asString(sp.note))}
    >
      <summary className="cursor-pointer text-sm font-medium text-card-foreground">
        Close ticket
      </summary>
      <form action={adminCloseTicketAction} className="mt-4 flex flex-col gap-4">
        <input type="hidden" name="id" value={ticketId} />
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-muted-foreground">
            Message to the requester
          </span>
          <span className="text-xs text-quiet">
            Optional. They will see this on the ticket.
          </span>
          <textarea
            name="message"
            rows={3}
            maxLength={10000}
            defaultValue={asString(sp.message)}
            placeholder="What you did, in plain language."
            className={`${ticketFieldClass} resize-y py-3 leading-relaxed`}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-muted-foreground">
            Resolution notes (admins only)
          </span>
          <span className="text-xs text-quiet">
            Optional. The person who asked never sees this.
          </span>
          <textarea
            name="note"
            rows={3}
            maxLength={10000}
            defaultValue={asString(sp.note)}
            placeholder="Anything the team should know next time."
            className={`${ticketFieldClass} resize-y py-3 leading-relaxed`}
          />
        </label>
        <div>
          <button type="submit" className={`${primaryButton} px-3 py-2`}>
            Resolve ticket
          </button>
        </div>
      </form>
    </details>
  )
}

/**
 * What the person who asked can do about their own request. One obvious
 * action per state, in their words rather than the schema's.
 *
 * These buttons mirror the database's member state machine; they are not the
 * authority on it. member_set_ticket_status refuses anything not offered here,
 * so a stale page cannot become a wrong write.
 */
function RequesterActions({
  ticketId,
  status,
  sp,
}: {
  ticketId: string
  status: TicketStatus
  sp: Record<string, string | string[] | undefined>
}) {
  const asString = (v: string | string[] | undefined) =>
    typeof v === 'string' ? v : ''
  const box =
    'flex max-w-2xl flex-col gap-3 rounded-button border border-border bg-card px-5 py-4'

  if (status === 'open' || status === 'in_progress') {
    return (
      <div className={box}>
        <p className="text-sm text-card-foreground">
          Is this sorted, or do you not need it any more?
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <form action={memberSetTicketStatusAction}>
            <input type="hidden" name="id" value={ticketId} />
            <input type="hidden" name="status" value="resolved" />
            <button type="submit" className={`${primaryButton} px-3 py-2`}>
              This is resolved
            </button>
          </form>
          <Link href={`/dashboard/tickets/${ticketId}/cancel`} className={ghostButton}>
            Cancel this request
          </Link>
        </div>
      </div>
    )
  }

  if (status === 'resolved') {
    return (
      <div className={box}>
        <p className="text-sm text-card-foreground">
          This is marked as sorted. If it is not, say what is still wrong and it
          goes back to your IT team.
        </p>
        {/* The reopen form and the remove form are siblings, never nested:
            a form inside a form is invalid and the inner one is dropped. */}
        <form
          action={memberSetTicketStatusAction}
          className="flex flex-col gap-3"
        >
          <input type="hidden" name="id" value={ticketId} />
          <input type="hidden" name="status" value="open" />
          <textarea
            name="explanation"
            required
            rows={3}
            maxLength={10000}
            defaultValue={asString(sp.explanation)}
            placeholder="What is still happening?"
            className={`${ticketFieldClass} resize-y py-3 leading-relaxed`}
          />
          <div>
            <button type="submit" className={`${primaryButton} px-3 py-2`}>
              Reopen this request
            </button>
          </div>
        </form>
        <HideFromListButton ticketId={ticketId} />
      </div>
    )
  }

  // Canceled. Terminal for the requester by ruling: a problem coming back is a
  // new request, not this one waking up. The only thing left to do is tidy.
  return (
    <div className={box}>
      <p className="text-sm text-card-foreground">
        You withdrew this request. If you need it again, start a new one.
      </p>
      <div>
        <HideFromListButton ticketId={ticketId} />
      </div>
    </div>
  )
}

function HideFromListButton({ ticketId }: { ticketId: string }) {
  return (
    <form action={memberHideTicketAction}>
      <input type="hidden" name="id" value={ticketId} />
      <button type="submit" className={ghostButton}>
        Remove from my list
      </button>
    </form>
  )
}
