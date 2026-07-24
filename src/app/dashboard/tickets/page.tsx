import Link from 'next/link'

import { UNKNOWN_MEMBER, resolveUserNames } from '@/lib/auth/user-names'
import { getTicketViewer, listTickets } from '@/lib/db/tickets'
import type { Ticket, TicketStatus } from '@/lib/db/types'
import { formatUtc, primaryButton } from '../monitors/ui'
import { isTicketStatus } from '@/lib/db/tickets'
import { STATUS_LABEL, TicketStatusBadge } from './ui'

export const metadata = { title: 'Tickets — Talvex' }

/**
 * The ticket queue (Phase 1 Task 3). Server component; rows come through
 * the org scoped data layer, so RLS has already applied the role rule: a
 * member is looking at their own requests, an org admin at every request in
 * the org. Open sits first, oldest at the top, so the longest waiting
 * request is the first thing an admin sees. Admins get status filters;
 * members get their short list unfiltered.
 */
export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const rawStatus = typeof sp.status === 'string' ? sp.status : ''

  const viewer = await getTicketViewer()
  const filter: TicketStatus | undefined =
    viewer.isAdmin && isTicketStatus(rawStatus) ? rawStatus : undefined

  const tickets = await listTickets(filter)
  const names = viewer.isAdmin
    ? await resolveUserNames(tickets.map((t) => t.submitted_by))
    : new Map<string, string>()

  return (
    <main className="flex flex-1 flex-col gap-6 p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-title text-foreground">Tickets</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {viewer.isAdmin
              ? 'Every request in your organization. Open first, oldest at the top.'
              : 'Your requests, and where each one stands.'}
          </p>
        </div>
        <Link href="/dashboard/get-help" className={primaryButton}>
          Get help
        </Link>
      </div>

      {viewer.isAdmin ? <StatusFilters current={filter} /> : null}

      {tickets.length === 0 ? (
        <EmptyState isAdmin={viewer.isAdmin} filtered={filter !== undefined} />
      ) : (
        <TicketTable
          tickets={tickets}
          showSubmitter={viewer.isAdmin}
          names={names}
        />
      )}
    </main>
  )
}

const FILTERS: Array<{ label: string; status?: TicketStatus }> = [
  { label: 'All' },
  { label: STATUS_LABEL.open, status: 'open' },
  { label: STATUS_LABEL.in_progress, status: 'in_progress' },
  { label: STATUS_LABEL.resolved, status: 'resolved' },
  { label: STATUS_LABEL.closed, status: 'closed' },
]

function StatusFilters({ current }: { current?: TicketStatus }) {
  return (
    <nav className="flex flex-wrap items-center gap-2 text-sm" aria-label="Filter by status">
      {FILTERS.map(({ label, status }) => {
        const active = status === current
        return (
          <Link
            key={label}
            href={status ? `/dashboard/tickets?status=${status}` : '/dashboard/tickets'}
            aria-current={active ? 'page' : undefined}
            className={
              active
                ? 'rounded-button border border-(--accent-outline) px-3 py-1.5 font-medium text-accent-text'
                : 'rounded-button border border-transparent px-3 py-1.5 text-muted-foreground transition-colors hover:bg-(--ghost-hover-bg) hover:text-foreground'
            }
          >
            {label}
          </Link>
        )
      })}
    </nav>
  )
}

function EmptyState({ isAdmin, filtered }: { isAdmin: boolean; filtered: boolean }) {
  if (filtered) {
    return (
      <p className="text-sm text-muted-foreground">
        No tickets with this status right now.
      </p>
    )
  }
  return (
    <div className="flex max-w-xl flex-col items-start gap-4 rounded-button border border-border bg-card p-8">
      <h2 className="text-base font-semibold text-card-foreground">
        {isAdmin ? 'No tickets yet' : 'No requests yet'}
      </h2>
      <p className="text-sm leading-relaxed text-muted-foreground">
        {isAdmin
          ? 'When someone in your organization asks for help, their request lands here with the oldest waiting at the top.'
          : 'When you ask for help, your request lives here so you can follow along and add details.'}
      </p>
      {isAdmin ? null : (
        <Link href="/dashboard/get-help" className={primaryButton}>
          Get help
        </Link>
      )}
    </div>
  )
}

function TicketTable({
  tickets,
  showSubmitter,
  names,
}: {
  tickets: Ticket[]
  showSubmitter: boolean
  names: Map<string, string>
}) {
  return (
    <div className="overflow-x-auto rounded-button border border-border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-quiet">
            <th className="px-5 py-3 font-medium">Request</th>
            {showSubmitter ? (
              <th className="px-5 py-3 font-medium">From</th>
            ) : null}
            <th className="px-5 py-3 font-medium">Status</th>
            <th className="px-5 py-3 font-medium">Submitted</th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((ticket) => (
            <tr key={ticket.id} className="border-b border-border last:border-b-0">
              <td className="max-w-md px-5 py-4">
                <Link
                  href={`/dashboard/tickets/${ticket.id}`}
                  className="font-medium text-card-foreground hover:text-accent-text"
                >
                  {ticket.title}
                </Link>
              </td>
              {showSubmitter ? (
                <td className="px-5 py-4 text-card-foreground">
                  {names.get(ticket.submitted_by) ?? UNKNOWN_MEMBER}
                </td>
              ) : null}
              <td className="px-5 py-4">
                <TicketStatusBadge status={ticket.status as TicketStatus} />
              </td>
              <td className="px-5 py-4 text-card-foreground">
                {formatUtc(ticket.created_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
