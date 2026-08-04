import Link from 'next/link'

import { UNKNOWN_MEMBER, resolveUserNames } from '@/lib/auth/user-names'
import {
  getTicketViewer,
  isTicketStatus,
  listTickets,
  listTicketsForRequester,
  MEMBER_LIST_TERMINAL_DAYS,
} from '@/lib/db/tickets'
import type { Ticket, TicketStatus } from '@/lib/db/types'

import { shortAge, summarizeTickets, ticketSource } from '../_overview/lib'
import { Card, TicketTile } from '../_overview/ui'
import { primaryButton } from '../monitors/ui'
import { STATUS_LABEL, TicketStatusBadge } from './ui'

export const metadata = { title: 'Tickets — Talvext' }

const ROW = 'grid grid-cols-[minmax(0,1fr)_150px_140px_118px] gap-3.5'

/**
 * The ticket queue (Phase 1 Task 3 data), restyled to the handoff. RLS applies
 * the role rule: an admin sees every request in the org, a member sees only
 * their own. Admins get the queue design (count tiles + table); members get the
 * "My requests" design. All real data. Tickets carry a requester, not an
 * assignee (no assignee column), so the design's Assignee column shows who the
 * request is from.
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

  const nowMs = new Date().getTime()

  // The requester's list has its own rule (settled longer than a week, or
  // removed by hand, drops off) so it takes its own query. Admin lists are
  // untouched by both: every ticket, forever.
  if (!viewer.isAdmin) {
    const showAll = typeof sp.show === 'string' && sp.show === 'all'
    const { tickets: mine, hiddenCount } = await listTicketsForRequester(
      showAll,
      nowMs,
    )
    return (
      <MyRequests
        tickets={mine}
        nowMs={nowMs}
        counts={summarizeTickets(mine, nowMs)}
        showAll={showAll}
        hiddenCount={hiddenCount}
      />
    )
  }

  const tickets = await listTickets()
  const counts = summarizeTickets(tickets, nowMs)
  const rows = filter ? tickets.filter((t) => t.status === filter) : tickets
  const names = await resolveUserNames(tickets.map((t) => t.submitted_by))

  return (
    <main id="main-content" className="mx-auto w-full max-w-[1360px] flex-1 animate-fade-up px-8 pt-[30px] pb-[72px]">
      <div className="mb-[22px] flex flex-wrap items-end justify-between gap-5">
        <div>
          <h1 className="text-title text-foreground">Tickets</h1>
          <p className="mt-1.5 text-[14px] text-quiet">
            {counts.open} open · {counts.inProgress} in progress
          </p>
        </div>
        <Link href="/dashboard/help" className={primaryButton}>
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mr-1.5"
            aria-hidden
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          New ticket
        </Link>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <TicketTile value={counts.open} label="Open" valueClass="text-status-pending" />
        <TicketTile
          value={counts.inProgress}
          label="In progress"
          valueClass="text-accent-text"
        />
        <TicketTile
          value={counts.resolvedToday}
          label="Resolved today"
          valueClass="text-status-up"
        />
        <TicketTile
          value={counts.canceled}
          label="Canceled"
          valueClass="text-quiet"
        />
      </div>

      {/* Status filters are not in the prototype, but they are existing admin
          functionality, so they are kept (restyled) rather than removed. */}
      <StatusFilters current={filter} />

      {rows.length === 0 ? (
        <p className="text-sm text-quiet">
          {filter
            ? 'No tickets with this status right now.'
            : 'No tickets yet.'}
        </p>
      ) : (
        <Card className="pb-2">
          <div
            className={`${ROW} px-[22px] py-3.5 text-column text-quiet uppercase`}
          >
            <span>Ticket</span>
            <span>Source</span>
            <span>Requested by</span>
            <span>Status</span>
          </div>
          {rows.map((t) => (
            <div
              key={t.id}
              className={`${ROW} items-center border-t border-divider px-[22px] py-3.5`}
            >
              <div className="min-w-0">
                <Link
                  href={`/dashboard/tickets/${t.id}`}
                  className="block truncate text-sm font-medium text-foreground hover:text-accent-text"
                >
                  {t.title}
                </Link>
                <div className="mt-0.5 truncate text-[12px] text-quiet">
                  {t.description} · {shortAge(t.created_at, nowMs)} ago
                </div>
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <span className="truncate text-[12px] text-muted-foreground">
                  {ticketSource(t)}
                </span>
                {t.incident_id ? (
                  <span className="max-w-full self-start truncate rounded-full bg-tile px-2 py-0.5 text-[10.5px] font-medium text-chip-text">
                    ↳ linked incident
                  </span>
                ) : null}
              </div>
              <div className="min-w-0 truncate text-[13px] text-muted-foreground">
                {names.get(t.submitted_by) ?? UNKNOWN_MEMBER}
              </div>
              <div>
                <TicketStatusBadge status={t.status as TicketStatus} />
              </div>
            </div>
          ))}
        </Card>
      )}
    </main>
  )
}

const FILTERS: Array<{ label: string; status?: TicketStatus }> = [
  { label: 'All' },
  { label: STATUS_LABEL.open, status: 'open' },
  { label: STATUS_LABEL.in_progress, status: 'in_progress' },
  { label: STATUS_LABEL.resolved, status: 'resolved' },
  { label: STATUS_LABEL.canceled, status: 'canceled' },
]

function StatusFilters({ current }: { current?: TicketStatus }) {
  return (
    <nav
      className="mb-4 flex flex-wrap items-center gap-1.5 text-sm"
      aria-label="Filter by status"
    >
      {FILTERS.map(({ label, status }) => {
        const active = status === current
        return (
          <Link
            key={label}
            href={
              status
                ? `/dashboard/tickets?status=${status}`
                : '/dashboard/tickets'
            }
            aria-current={active ? 'page' : undefined}
            className="nav-item rounded-nav px-3 py-1.5 text-[13px] font-medium transition-colors"
          >
            {label}
          </Link>
        )
      })}
    </nav>
  )
}

function MyRequests({
  tickets,
  nowMs,
  counts,
  showAll,
  hiddenCount,
}: {
  tickets: Ticket[]
  nowMs: number
  counts: { open: number; inProgress: number }
  showAll: boolean
  hiddenCount: number
}) {
  const openCount = counts.open + counts.inProgress
  return (
    <main id="main-content" className="mx-auto w-full max-w-[720px] flex-1 animate-fade-up px-6 pt-[30px] pb-[72px]">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-title text-foreground">My requests</h1>
          <p className="mt-1.5 text-[14px] text-quiet">
            {openCount} open · {tickets.length} shown
          </p>
        </div>
        <Link href="/dashboard/help" className={primaryButton}>
          New request
        </Link>
      </div>

      {/* Nothing is deleted and nothing moves. This toggle changes what is on
          screen and not what exists, so the wording says shown and hidden
          rather than anything that sounds like removal. */}
      {showAll || hiddenCount > 0 ? (
        <p className="mb-4 text-[13px] text-quiet">
          {showAll ? (
            <>
              Showing everything you have ever asked for.{' '}
              <Link href="/dashboard/tickets" className="text-link hover:text-foreground">
                Show only recent
              </Link>
            </>
          ) : (
            <>
              {hiddenCount} finished{' '}
              {hiddenCount === 1 ? 'request is' : 'requests are'} hidden:
              settled more than {MEMBER_LIST_TERMINAL_DAYS} days ago, or removed
              by you.{' '}
              <Link
                href="/dashboard/tickets?show=all"
                className="text-link hover:text-foreground"
              >
                Show all
              </Link>
            </>
          )}
        </p>
      ) : null}

      {tickets.length === 0 ? (
        <Card className="p-8">
          <h2 className="text-base font-semibold text-card-foreground">
            No requests yet
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            When you ask for help, your request lives here so you can follow along
            and add details.
          </p>
          <Link href="/dashboard/help" className={`${primaryButton} mt-4`}>
            Get help
          </Link>
        </Card>
      ) : (
        <Card className="pb-2">
          {tickets.map((t) => (
            <Link
              key={t.id}
              href={`/dashboard/tickets/${t.id}`}
              className="flex items-center gap-3.5 border-t border-divider px-[22px] py-[15px] transition-colors first:border-t-0 hover:bg-card-hover"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14.5px] font-medium text-foreground">
                  {t.title}
                </div>
                <div className="mt-0.5 text-[12.5px] text-quiet">
                  Updated {shortAge(t.updated_at, nowMs)} ago
                </div>
              </div>
              <TicketStatusBadge status={t.status as TicketStatus} />
            </Link>
          ))}
        </Card>
      )}
    </main>
  )
}
