import { notFound } from 'next/navigation'
import { cache } from 'react'

import { SiteFooter } from '@/components/site-footer'
import { StatusMark, StatusText, statusTextClass } from '@/components/status-mark'
import { getStatusPage, type PublicStatusIncident } from '@/lib/db/status-page'
import {
  aggregateUptime,
  buildHeatmap,
  deriveOverallState,
  formatUptime,
  type HeatmapCell,
  type HeatmapTone,
} from '@/lib/status/status-view'

/**
 * The public status page (BRD F9), served at /status/<slug> to anyone, no
 * login. It renders outside the dashboard shell (root layout only, dark theme)
 * and reads through the anon client, so RLS is the boundary: an unknown slug, a
 * disabled page, and an org with no monitors all fall through to the same 404,
 * so the page never reveals whether a slug exists.
 *
 * Statically generated with a 60 second revalidate: monitor data changes at
 * most every 5 minutes (the sweep), so a minute keeps the page within a minute
 * of the latest sweep while serving cached HTML to all traffic in between.
 */
export const revalidate = 60
export const dynamicParams = true

// One fetch per request, shared by metadata and the page.
const loadStatusPage = cache(getStatusPage)

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const page = await loadStatusPage(slug)
  // A missing page gets a generic title, never a "not found" that would confirm
  // the slug does not exist.
  if (!page) return { title: 'Status' }
  return {
    title: `${page.org.name} status`,
    description: `Live service status for ${page.org.name}.`,
  }
}

/* Each heatmap tone gets a fill pattern as well as a color, so a reader who
 * cannot separate green from amber from red can still read 90 days of history
 * off the shapes. The classes are defined in globals.css. */
const TONE_CLASS: Record<HeatmapTone, string> = {
  up: 'heat-up',
  partial: 'heat-partial',
  down: 'heat-down',
  none: 'heat-none',
}

const TONE_LABEL: Record<HeatmapTone, string> = {
  up: 'no downtime',
  partial: 'partial downtime',
  down: 'down',
  none: 'no data',
}

function monitorDotKind(last: 'up' | 'down' | null): 'up' | 'down' | 'pending' {
  return last === 'up' ? 'up' : last === 'down' ? 'down' : 'pending'
}

/** The state in words, for the public page. "Pending" is jargon to a client
 * looking at their dentist's status page; "No data yet" is not. */
const MONITOR_STATE_LABEL: Record<'up' | 'down' | 'pending', string> = {
  up: 'Operational',
  down: 'Down',
  pending: 'No data yet',
}

function formatDay(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

function incidentDuration(inc: PublicStatusIncident, nowMs: number): string {
  const end = inc.resolved_at ? Date.parse(inc.resolved_at) : nowMs
  const mins = Math.max(1, Math.round((end - Date.parse(inc.opened_at)) / 60000))
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  const rem = mins % 60
  if (hours < 24) return rem === 0 ? `${hours}h` : `${hours}h ${rem}m`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}

function Heatmap({ cells }: { cells: HeatmapCell[] }) {
  return (
    <div className="flex gap-[2px]" aria-hidden>
      {cells.map((c) => (
        <div
          key={c.day}
          title={`${c.day}: ${TONE_LABEL[c.tone]}${
            c.uptime === null ? '' : `, ${formatUptime(c.uptime)}`
          }`}
          className={`h-9 flex-1 rounded-[2px] ${TONE_CLASS[c.tone]}`}
        />
      ))}
    </div>
  )
}

/**
 * What the heatmap fills mean, in words. The patterns make the three states
 * separable without color; this says which is which, so neither channel has to
 * be guessed at.
 */
function HeatmapKey() {
  return (
    <ul className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] text-quiet">
      {(['up', 'partial', 'down', 'none'] as HeatmapTone[]).map((tone) => (
        <li key={tone} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={`h-2.5 w-2.5 flex-none rounded-[2px] ${TONE_CLASS[tone]}`}
          />
          {TONE_LABEL[tone]}
        </li>
      ))}
    </ul>
  )
}

export default async function StatusPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const page = await loadStatusPage(slug)
  // Unknown slug, disabled page, or empty org: one 404, indistinguishable.
  if (!page || page.monitors.length === 0) notFound()

  const now = new Date()
  const nowMs = now.getTime()
  const today = now.toISOString().slice(0, 10)
  const overall = deriveOverallState(page.monitors)

  const monitorName = new Map(page.monitors.map((m) => [m.id, m.name]))

  return (
    <>
    <main className="mx-auto w-full max-w-[860px] flex-1 px-6 pt-16 pb-24">
      {/* Header */}
      <header className="flex flex-col gap-4 border-b border-border pb-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
            {page.org.name}
          </h1>
          <span className="text-[12.5px] text-quiet">
            As of {now.toISOString().slice(0, 16).replace('T', ' ')} UTC
          </span>
        </div>
        <div
          className={`flex items-center gap-2.5 rounded-card px-4 py-3 ${
            overall.operational ? 'bg-wash-up' : 'bg-wash-down'
          }`}
        >
          <StatusText
            tone={overall.operational ? 'up' : 'down'}
            label={overall.label}
            size={10}
            className="text-[15px] font-medium"
          />
        </div>
      </header>

      {/* Monitors */}
      <section className="mt-8 flex flex-col gap-4">
        {page.monitors.map((m) => {
          const rollups = page.rollups.filter((r) => r.monitor_id === m.id)
          const uptime = aggregateUptime(rollups)
          const cells = buildHeatmap(rollups, today, 90)
          const dot = monitorDotKind(m.last_status)
          return (
            <div
              key={m.id}
              className="rounded-card border border-card-border bg-card px-5 py-4"
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <StatusMark tone={dot} size={10} />
                  <span className="truncate text-[15px] font-medium text-card-foreground">
                    {m.name}
                  </span>
                </div>
                <div className="flex flex-none items-center gap-3">
                  {/* The current state in words. Without it the mark beside the
                      name was the only carrier of up versus down, which is the
                      color alone failure the accessibility statement rules out. */}
                  <span
                    className={`text-[13px] font-medium ${statusTextClass(dot)}`}
                  >
                    {MONITOR_STATE_LABEL[dot]}
                  </span>
                  <span className="text-[13px] text-quiet">
                    {uptime === null
                      ? 'No uptime yet'
                      : `${formatUptime(uptime)} uptime`}
                  </span>
                </div>
              </div>
              <Heatmap cells={cells} />
              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 text-[11px] text-quiet">
                <span>{formatDay(cells[0].day)}</span>
                <span>90 days</span>
                <span>Today</span>
              </div>
            </div>
          )
        })}
        {/* One key for every heatmap above it, not one per card. */}
        <HeatmapKey />
      </section>

      {/* Incident history */}
      <section className="mt-10">
        <h2 className="text-[15px] font-semibold text-foreground">
          Recent incidents
        </h2>
        <p className="mt-1 text-[12.5px] text-quiet">Last 30 days.</p>
        {page.incidents.length === 0 ? (
          <p className="mt-4 text-[13.5px] text-muted-foreground">
            No incidents in the last 30 days.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col">
            {page.incidents.map((inc) => {
              const ongoing = inc.status !== 'resolved'
              return (
                <li
                  key={inc.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-t border-divider py-3.5 first:border-t-0"
                >
                  <div className="flex items-center gap-2.5">
                    <StatusMark tone={ongoing ? 'down' : 'up'} size={9} />
                    <span className="text-[13.5px] font-medium text-card-foreground">
                      {monitorName.get(inc.monitor_id) ?? 'A monitor'}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-[12.5px] text-quiet">
                    <span>
                      {new Date(inc.opened_at).toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: 'UTC',
                      })}{' '}
                      UTC
                    </span>
                    {/* "4h 12m" on its own left the green mark carrying the
                        fact that this one is over. Say so in words. */}
                    <span className={ongoing ? 'text-status-down' : ''}>
                      {ongoing
                        ? 'Ongoing'
                        : `Resolved in ${incidentDuration(inc, nowMs)}`}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <p className="mt-14 border-t border-border pt-6 text-center text-[12px] text-quiet">
        Status by Talvex
      </p>
    </main>
    {/* The shared public footer, so a visitor who only ever sees a tenant's
        status page can still reach the Talvex legal pages. */}
    <SiteFooter />
    </>
  )
}
