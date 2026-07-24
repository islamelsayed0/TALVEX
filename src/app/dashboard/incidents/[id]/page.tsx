import Link from 'next/link'
import { notFound } from 'next/navigation'

import { getActiveOrgViewer } from '@/lib/auth/org-viewer'
import { getIncident, listIncidentEvents } from '@/lib/db/incidents'
import { listTicketsForIncident } from '@/lib/db/tickets'
import type { IncidentEventType, TicketStatus } from '@/lib/db/types'
import { formatUtc, primaryButton } from '../../monitors/ui'
import { TicketStatusBadge } from '../../tickets/ui'
import {
  elapsedSince,
  EVENT_COPY,
  IncidentBadge,
  incidentDuration,
  incidentTicketPrefill,
} from '../ui'

export const metadata = { title: 'Incident — Talvex' }

/**
 * Incident detail: the record of one outage. The timeline is the feature.
 * Every event on it was written by the system when it happened; nobody can
 * edit or remove one, so what this page shows is what actually occurred.
 *
 * An incident id belonging to another org 404s exactly like one that does
 * not exist: RLS returns no row either way, and the UI must not be able to
 * tell the difference.
 */
export default async function IncidentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const incident = await getIncident(id)
  if (!incident) notFound()

  const [events, viewer, linkedTickets] = await Promise.all([
    listIncidentEvents(incident.id),
    getActiveOrgViewer(),
    listTicketsForIncident(incident.id),
  ])
  const open = incident.status === 'open'
  const reopenCount = events.filter((e) => e.event_type === 'reopened').length

  // The Create ticket button prefills the normal Get help form and carries the
  // incident id so the new ticket links back (Task 4). Admin only, since
  // ticket workflow is an admin concern; RLS still allows a same org link from
  // anyone, so this button is presentation, not the security boundary.
  const prefill = incidentTicketPrefill({
    monitorName: incident.monitorName,
    monitorUrl: incident.monitorUrl,
    openedAt: incident.opened_at,
    status: open ? 'open' : 'resolved',
    reopenCount,
  })
  const createTicketHref = `/dashboard/get-help/ticket?${new URLSearchParams({
    title: prefill.title,
    description: prefill.description,
    incident_id: incident.id,
  })}`

  return (
    <main className="flex flex-1 flex-col gap-6 p-8">
      <div>
        <Link
          href="/dashboard/incidents"
          className="text-xs text-link hover:text-foreground"
        >
          ← All incidents
        </Link>
        <div className="mt-2 flex items-center gap-4">
          <h1 className="text-title text-foreground">{incident.monitorName}</h1>
          <IncidentBadge status={open ? 'open' : 'resolved'} />
        </div>
        <p className="mt-1 font-mono text-xs text-quiet">{incident.monitorUrl}</p>
      </div>

      <dl className="grid max-w-2xl grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-button border border-border bg-card p-4">
          <dt className="text-xs text-quiet">Opened</dt>
          <dd className="mt-1.5 text-sm font-medium text-card-foreground">
            {formatUtc(incident.opened_at)}
          </dd>
        </div>
        <div className="rounded-button border border-border bg-card p-4">
          <dt className="text-xs text-quiet">
            {open ? 'Ongoing for' : 'Lasted'}
          </dt>
          <dd className="mt-1.5 text-sm font-medium text-card-foreground">
            {open ? elapsedSince(incident.opened_at) : incidentDuration(incident)}
          </dd>
        </div>
        <div className="rounded-button border border-border bg-card p-4">
          <dt className="text-xs text-quiet">Resolved</dt>
          <dd className="mt-1.5 text-sm font-medium text-card-foreground">
            {incident.resolved_at ? formatUtc(incident.resolved_at) : 'Not yet'}
          </dd>
        </div>
        <div className="rounded-button border border-border bg-card p-4">
          <dt className="text-xs text-quiet">Monitor</dt>
          <dd className="mt-1.5 text-sm font-medium">
            <Link
              href={`/dashboard/monitors/${incident.monitor_id}`}
              className="text-accent-text hover:underline"
            >
              View monitor
            </Link>
          </dd>
        </div>
      </dl>

      {viewer.isAdmin || linkedTickets.length > 0 ? (
        <section className="max-w-2xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-foreground">Tickets</h2>
            {viewer.isAdmin ? (
              <Link href={createTicketHref} className={`${primaryButton} px-3 py-2`}>
                Create ticket
              </Link>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {viewer.isAdmin
              ? 'Open a ticket to track the work this outage needs. It stays linked here.'
              : 'Tickets created from this incident.'}
          </p>
          {linkedTickets.length > 0 ? (
            <ul className="mt-4 flex flex-col gap-2">
              {linkedTickets.map((ticket) => (
                <li key={ticket.id}>
                  <Link
                    href={`/dashboard/tickets/${ticket.id}`}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-button border border-border bg-card px-5 py-4 transition-colors hover:border-(--ghost-border-hover)"
                  >
                    <span className="text-sm font-medium text-card-foreground">
                      {ticket.title}
                    </span>
                    <TicketStatusBadge status={ticket.status as TicketStatus} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-quiet">
              No tickets yet from this incident.
            </p>
          )}
        </section>
      ) : null}

      <section className="max-w-2xl">
        <h2 className="text-base font-semibold text-foreground">Timeline</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Written by the system as it happened. Times are UTC.
        </p>
        {events.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No events recorded for this incident.
          </p>
        ) : (
          <ol className="mt-4 flex flex-col rounded-button border border-border bg-card p-6">
            {events.map((event, index) => {
              const copy = EVENT_COPY[event.event_type as IncidentEventType] ?? {
                label: event.event_type,
                tone: 'down' as const,
              }
              return (
                <li key={event.id} className="relative flex gap-4 pb-6 last:pb-0">
                  {/* The connecting line, drawn between dots, not past the last. */}
                  {index < events.length - 1 ? (
                    <span
                      className="absolute top-3 left-[3.5px] h-full w-px bg-border"
                      aria-hidden
                    />
                  ) : null}
                  <span
                    className={`relative mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                      copy.tone === 'down' ? 'bg-status-down' : 'bg-status-up'
                    }`}
                    aria-hidden
                  />
                  <div className="flex flex-col gap-0.5">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                      <span className="text-sm font-medium text-card-foreground">
                        {copy.label}
                      </span>
                      <span className="text-xs text-quiet">
                        {formatUtc(event.occurred_at)}
                      </span>
                    </div>
                    {event.detail ? (
                      <p className="text-sm text-muted-foreground">{event.detail}</p>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </section>
    </main>
  )
}
