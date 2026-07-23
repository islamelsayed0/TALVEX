import Link from 'next/link'

import { listIncidents, type IncidentListItem } from '@/lib/db/incidents'
import { formatUtc } from '../monitors/ui'
import { IncidentBadge, incidentDuration } from './ui'

export const metadata = { title: 'Incidents — Talvex' }

/**
 * The incidents list (Phase 1 Task 2). Server component: rows come through
 * the org scoped data layer, so RLS has already filtered them. Open
 * incidents first, then the recently resolved ones. Everything here is
 * written by the system; there are no actions to take on this screen yet.
 */
export default async function IncidentsPage() {
  const { open, resolved } = await listIncidents()
  const empty = open.length === 0 && resolved.length === 0

  return (
    <main className="flex flex-1 flex-col gap-6 p-8">
      <div>
        <h1 className="text-title text-foreground">Incidents</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Outages Talvex detected on your monitors, opened and resolved
          automatically.
        </p>
      </div>

      {empty ? (
        <div className="flex max-w-xl flex-col items-start gap-4 rounded-button border border-border bg-card p-8">
          <h2 className="text-base font-semibold text-card-foreground">
            No incidents
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            When a monitor fails two checks in a row, an incident opens here
            with a timeline of what happened. When the monitor recovers, the
            incident resolves on its own. Nothing has gone down so far.
          </p>
        </div>
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-base font-semibold text-foreground">Open now</h2>
            {open.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No open incidents. Everything is up.
              </p>
            ) : (
              <IncidentTable incidents={open} />
            )}
          </section>

          {resolved.length > 0 ? (
            <section className="flex flex-col gap-3">
              <h2 className="text-base font-semibold text-foreground">
                Recently resolved
              </h2>
              <IncidentTable incidents={resolved} />
            </section>
          ) : null}
        </>
      )}
    </main>
  )
}

function IncidentTable({ incidents }: { incidents: IncidentListItem[] }) {
  return (
    <div className="overflow-x-auto rounded-button border border-border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-quiet">
            <th className="px-5 py-3 font-medium">Monitor</th>
            <th className="px-5 py-3 font-medium">Status</th>
            <th className="px-5 py-3 font-medium">Opened</th>
            <th className="px-5 py-3 font-medium">Duration</th>
            <th className="px-5 py-3 font-medium">Reopened</th>
          </tr>
        </thead>
        <tbody>
          {incidents.map((incident) => (
            <tr key={incident.id} className="border-b border-border last:border-b-0">
              <td className="px-5 py-4">
                <Link
                  href={`/dashboard/incidents/${incident.id}`}
                  className="font-medium text-card-foreground hover:text-accent-text"
                >
                  {incident.monitorName}
                </Link>
              </td>
              <td className="px-5 py-4">
                <IncidentBadge status={incident.status === 'open' ? 'open' : 'resolved'} />
              </td>
              <td className="px-5 py-4 text-card-foreground">
                {formatUtc(incident.opened_at)}
              </td>
              <td className="px-5 py-4 text-card-foreground">
                {incidentDuration(incident)}
              </td>
              <td className="px-5 py-4 text-card-foreground">
                {incident.reopenCount > 0
                  ? `${incident.reopenCount} ${incident.reopenCount === 1 ? 'time' : 'times'}`
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
