import Link from 'next/link'
import { notFound } from 'next/navigation'

import { listMonitorIncidents } from '@/lib/db/incidents'
import {
  getMonitor,
  getUptimePercent30d,
  listRecentChecks,
} from '@/lib/db/monitors'
import { IncidentBadge, incidentDuration } from '../../incidents/ui'
import {
  formatMs,
  formatUptime,
  formatUtc,
  ghostButton,
  monitorStatus,
  StatusBadge,
} from '../ui'
import { ResponseChart } from './response-chart'

export const metadata = { title: 'Monitor — Talvex' }

/**
 * Monitor detail: current status, the 30 day uptime figure, response time
 * over the recent checks, incident history, and the recent raw checks.
 *
 * A monitor id belonging to another org 404s exactly like one that does
 * not exist: RLS returns no row either way, and the UI must not be able
 * to tell the difference.
 */
export default async function MonitorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const monitor = await getMonitor(id)
  if (!monitor) notFound()

  const [checks, uptime, incidents] = await Promise.all([
    listRecentChecks(monitor.id),
    getUptimePercent30d(monitor.id),
    listMonitorIncidents(monitor.id),
  ])

  const intervalMinutes = Math.round(monitor.interval_seconds / 60)

  return (
    <main className="flex flex-1 flex-col gap-6 p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/dashboard/monitors"
            className="text-xs text-link hover:text-foreground"
          >
            ← All monitors
          </Link>
          <h1 className="mt-2 text-title text-foreground">{monitor.name}</h1>
          <p className="mt-1 font-mono text-xs text-quiet">{monitor.url}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href={`/dashboard/monitors/${monitor.id}/edit`} className={ghostButton}>
            Edit
          </Link>
          <Link href={`/dashboard/monitors/${monitor.id}/delete`} className={ghostButton}>
            Delete
          </Link>
        </div>
      </div>

      <dl className="grid max-w-2xl grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-button border border-border bg-card p-4">
          <dt className="text-xs text-quiet">Status</dt>
          <dd className="mt-1.5">
            <StatusBadge status={monitorStatus(monitor)} />
          </dd>
        </div>
        <div className="rounded-button border border-border bg-card p-4">
          <dt className="text-xs text-quiet">Uptime, 30 days</dt>
          <dd className="mt-1.5 text-sm font-medium text-card-foreground">
            {formatUptime(uptime)}
          </dd>
        </div>
        <div className="rounded-button border border-border bg-card p-4">
          <dt className="text-xs text-quiet">Check interval</dt>
          <dd className="mt-1.5 text-sm font-medium text-card-foreground">
            {intervalMinutes >= 60
              ? 'Every hour'
              : `Every ${intervalMinutes} minutes`}
          </dd>
        </div>
        <div className="rounded-button border border-border bg-card p-4">
          <dt className="text-xs text-quiet">Last checked</dt>
          <dd className="mt-1.5 text-sm font-medium text-card-foreground">
            {monitor.last_checked_at ? formatUtc(monitor.last_checked_at) : 'Not yet'}
          </dd>
        </div>
      </dl>

      {checks.some((c) => c.response_time_ms !== null) ? (
        <section className="max-w-2xl">
          <h2 className="text-base font-semibold text-foreground">
            Response time
          </h2>
          <div className="mt-3">
            <ResponseChart checks={checks} />
          </div>
        </section>
      ) : null}

      <section className="max-w-2xl">
        <h2 className="text-base font-semibold text-foreground">Incidents</h2>
        {incidents.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No incidents on this monitor. If it ever fails two checks in a
            row, the outage will be recorded here.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-button border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-quiet">
                  <th className="px-5 py-3 font-medium">Opened</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Duration</th>
                  <th className="px-5 py-3 font-medium">Reopened</th>
                </tr>
              </thead>
              <tbody>
                {incidents.map((incident) => (
                  <tr key={incident.id} className="border-b border-border last:border-b-0">
                    <td className="px-5 py-3">
                      <Link
                        href={`/dashboard/incidents/${incident.id}`}
                        className="font-medium text-card-foreground hover:text-accent-text"
                      >
                        {formatUtc(incident.opened_at)}
                      </Link>
                    </td>
                    <td className="px-5 py-3">
                      <IncidentBadge
                        status={incident.status === 'open' ? 'open' : 'resolved'}
                      />
                    </td>
                    <td className="px-5 py-3 text-card-foreground">
                      {incidentDuration(incident)}
                    </td>
                    <td className="px-5 py-3 text-card-foreground">
                      {incident.reopenCount > 0
                        ? `${incident.reopenCount} ${incident.reopenCount === 1 ? 'time' : 'times'}`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="max-w-2xl">
        <h2 className="text-base font-semibold text-foreground">Recent checks</h2>
        {checks.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No checks recorded yet. The next sweep will run this monitor.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-button border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-quiet">
                  <th className="px-5 py-3 font-medium">Checked</th>
                  <th className="px-5 py-3 font-medium">Result</th>
                  <th className="px-5 py-3 font-medium">Response time</th>
                  <th className="px-5 py-3 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody>
                {checks.map((check) => (
                  <tr key={check.id} className="border-b border-border last:border-b-0">
                    <td className="px-5 py-3 text-card-foreground">
                      {formatUtc(check.checked_at)}
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={check.status === 'up' ? 'up' : 'down'} />
                    </td>
                    <td className="px-5 py-3 text-card-foreground">
                      {formatMs(check.response_time_ms)}
                    </td>
                    <td className="px-5 py-3 text-xs text-muted-foreground">
                      {check.error_message ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}
