import Link from 'next/link'

import { listMonitorsWithStats } from '@/lib/db/monitors'
import {
  formatMs,
  formatUptime,
  monitorStatus,
  primaryButton,
  StatusBadge,
} from './ui'

export const metadata = { title: 'Monitors — Talvex' }

/**
 * The monitors list (Phase 1 Task 1). Server component: rows come through
 * the org scoped data layer, so RLS has already filtered them to the active
 * organization. First legitimate use of the reserved status palette.
 */
export default async function MonitorsPage() {
  const monitors = await listMonitorsWithStats()

  return (
    <main className="flex flex-1 flex-col gap-6 p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-title text-foreground">Monitors</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Uptime checks for the sites and services your organization cares
            about.
          </p>
        </div>
        {monitors.length > 0 ? (
          <Link href="/dashboard/monitors/new" className={primaryButton}>
            Add monitor
          </Link>
        ) : null}
      </div>

      {monitors.length === 0 ? (
        <div className="flex max-w-xl flex-col items-start gap-4 rounded-button border border-border bg-card p-8">
          <h2 className="text-base font-semibold text-card-foreground">
            No monitors yet
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            A monitor checks a URL on a schedule and records whether it
            responded and how fast. Add your first one and Talvex starts
            watching it for you.
          </p>
          <Link href="/dashboard/monitors/new" className={primaryButton}>
            Add your first monitor
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-button border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-quiet">
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Response time</th>
                <th className="px-5 py-3 font-medium">Uptime, 30 days</th>
              </tr>
            </thead>
            <tbody>
              {monitors.map((monitor) => (
                <tr
                  key={monitor.id}
                  className="border-b border-border last:border-b-0"
                >
                  <td className="px-5 py-4">
                    <Link
                      href={`/dashboard/monitors/${monitor.id}`}
                      className="font-medium text-card-foreground hover:text-accent-text"
                    >
                      {monitor.name}
                    </Link>
                    <div className="mt-0.5 font-mono text-xs text-quiet">
                      {monitor.url}
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <StatusBadge status={monitorStatus(monitor)} />
                  </td>
                  <td className="px-5 py-4 text-card-foreground">
                    {formatMs(monitor.lastResponseMs)}
                  </td>
                  <td className="px-5 py-4 text-card-foreground">
                    {formatUptime(monitor.uptimePercent30d)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
