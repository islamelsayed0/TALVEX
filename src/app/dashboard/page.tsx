import { currentUser } from '@clerk/nextjs/server'
import Link from 'next/link'

import { requireAdmin } from '@/lib/auth/org-viewer'
import { listIncidents } from '@/lib/db/incidents'
import {
  listMonitorsWithRecentChecks,
  responseTrend,
} from '@/lib/db/monitors'
import { listTickets } from '@/lib/db/tickets'
import type { TicketStatus } from '@/lib/db/types'

import { monitorStatus } from './monitors/ui'
import {
  buildActivity,
  deriveVerdict,
  greeting,
  shortAge,
  summarizeTickets,
  ticketSource,
} from './_overview/lib'
import {
  ActivityRow,
  Card,
  IncidentItem,
  KpiCard,
  MonitorRow,
  NoIncidents,
  SegBar,
  Sparkline,
  TicketRow,
  TicketTile,
  VerdictBanner,
} from './_overview/ui'

export const metadata = { title: 'Overview — Talvex' }

/**
 * The admin Overview: five second triage. Every number, bar, and line here is
 * real data from the org scoped layer. Where the design shows a value with no
 * source yet (SLA countdown, blast radius, recurrence window, last fix, the
 * Notify / Assign / Acknowledge actions), the surrounding UI is built and the
 * value is left out with a marked TODO, never faked. The prototype's scenario
 * switcher is a demo control and is not shipped.
 */
export default async function OverviewPage() {
  await requireAdmin()

  const now = new Date()
  const nowMs = now.getTime()

  const [user, monitors, trend, incidents, tickets] = await Promise.all([
    currentUser(),
    listMonitorsWithRecentChecks(),
    responseTrend(),
    listIncidents(),
    listTickets(),
  ])

  const withStatus = monitors.map((m) => ({ m, status: monitorStatus(m) }))
  const up = withStatus.filter((x) => x.status === 'up')
  const down = withStatus.filter((x) => x.status === 'down')
  const paused = withStatus.filter((x) => x.status === 'paused')

  const responders = up
    .map((x) => x.m.lastResponseMs)
    .filter((n): n is number => n !== null)
  const avgMs = responders.length
    ? Math.round(responders.reduce((a, b) => a + b, 0) / responders.length)
    : null

  const counts = summarizeTickets(tickets, nowMs)
  const openTickets = counts.open + counts.inProgress
  const openIncidentCount = incidents.open.length

  const verdict = deriveVerdict({
    downNames: down.map((x) => x.m.name),
    openIncidents: openIncidentCount,
    openTickets,
    upCount: up.length,
  })

  const oldestOpen = incidents.open[incidents.open.length - 1]
  const lastResolvedAt = incidents.resolved[0]?.resolved_at ?? null

  const activity = buildActivity({
    openIncidents: incidents.open.map((i) => ({
      id: i.id,
      monitorName: i.monitorName,
      opened_at: i.opened_at,
    })),
    resolvedIncidents: incidents.resolved.map((i) => ({
      id: i.id,
      monitorName: i.monitorName,
      resolved_at: i.resolved_at,
    })),
    tickets: tickets.map((t) => ({
      id: t.id,
      title: t.title,
      created_at: t.created_at,
      incident_id: t.incident_id,
    })),
  })

  const queueTickets = [...tickets]
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, 4)

  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })

  return (
    <main className="mx-auto w-full max-w-[1360px] flex-1 animate-fade-up px-8 pt-[30px] pb-[72px]">
      {/* Greeting. No scenario switcher: that was a prototype demo control. */}
      <div className="mb-[22px]">
        <h1 className="text-title text-foreground">
          {greeting(now, user?.firstName ?? 'there')}
        </h1>
        <p className="mt-1.5 text-[14.5px] text-quiet">
          {dateStr} · Updated just now
        </p>
      </div>

      <div className="mb-[18px]">
        <VerdictBanner verdict={verdict} actionHref="/dashboard/incidents" />
      </div>

      {/* KPI strip. */}
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="Monitors"
          value={down.length > 0 ? String(down.length) : String(up.length)}
          unit={down.length > 0 ? 'down' : 'up'}
          valueClass={down.length > 0 ? 'text-status-down' : 'text-status-up'}
          sub={`${up.length} up · ${paused.length} paused`}
          viz={
            <SegBar
              segments={[
                { value: up.length, className: 'bg-status-up' },
                { value: down.length, className: 'bg-status-down' },
                { value: paused.length, className: 'bg-quiet/50' },
              ]}
            />
          }
        />
        <KpiCard
          label="Open incidents"
          value={String(openIncidentCount)}
          valueClass={openIncidentCount > 0 ? 'text-status-down' : 'text-foreground'}
          sub={
            openIncidentCount > 0 && oldestOpen
              ? `oldest opened ${shortAge(oldestOpen.opened_at, nowMs)} ago`
              : lastResolvedAt
                ? `last one ${shortAge(lastResolvedAt, nowMs)} ago`
                : 'none yet'
          }
          viz={
            <SegBar
              segments={[
                { value: openIncidentCount, className: 'bg-status-down' },
                { value: Math.max(up.length, 1), className: 'bg-status-up' },
              ]}
            />
          }
        />
        <KpiCard
          label="Open tickets"
          value={String(openTickets)}
          sub={`${counts.inProgress} in progress`}
          viz={
            <SegBar
              segments={[
                { value: counts.open, className: 'bg-status-pending' },
                { value: counts.inProgress, className: 'bg-accent-text' },
                { value: counts.resolvedToday, className: 'bg-status-up' },
              ]}
            />
          }
        />
        <KpiCard
          label="Avg response"
          value={avgMs !== null ? String(avgMs) : '—'}
          unit={avgMs !== null ? 'ms' : undefined}
          sub={
            responders.length
              ? `across ${responders.length} up ${responders.length === 1 ? 'monitor' : 'monitors'}`
              : 'no responses yet'
          }
          viz={<Sparkline points={trend} />}
        />
      </div>

      {/* Two column body. */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.9fr)_minmax(320px,1fr)] lg:items-start">
        {/* Monitors panel. */}
        <Card className="pb-2">
          <div className="flex items-center justify-between px-[22px] pt-[18px] pb-3.5">
            <div>
              <h2 className="text-base font-semibold text-foreground">Monitors</h2>
              <p className="mt-0.5 text-[12.5px] text-quiet">
                {up.length} up · {down.length} down · {monitors.length} total
              </p>
            </div>
            <Link
              href="/dashboard/monitors"
              className="text-[13px] font-medium text-accent-text"
            >
              View all
            </Link>
          </div>
          {monitors.length === 0 ? (
            <div className="border-t border-divider px-[22px] py-8 text-center">
              <div className="text-sm font-medium text-foreground">
                No monitors yet
              </div>
              <Link
                href="/dashboard/monitors/new"
                className="mt-1 inline-block text-[13px] font-semibold text-accent-text"
              >
                Add your first monitor
              </Link>
            </div>
          ) : (
            <div className="max-h-[296px] overflow-y-auto">
              {withStatus.map(({ m }) => (
                <MonitorRow key={m.id} m={m} nowMs={nowMs} />
              ))}
            </div>
          )}
        </Card>

        {/* Right column. */}
        <div className="flex min-w-0 flex-col gap-5">
          <Card className="px-5 py-[18px]">
            <div className="mb-3.5 flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground">
                Open incidents
              </h2>
              <span
                className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${
                  openIncidentCount > 0
                    ? 'bg-wash-down text-status-down'
                    : 'bg-wash-up text-status-up'
                }`}
              >
                {openIncidentCount}
              </span>
            </div>
            {openIncidentCount > 0 ? (
              <div className="flex flex-col">
                {incidents.open.map((i) => (
                  <IncidentItem key={i.id} i={i} nowMs={nowMs} />
                ))}
              </div>
            ) : (
              <NoIncidents lastResolvedAt={lastResolvedAt} nowMs={nowMs} />
            )}
          </Card>

          <Card className="px-5 py-[18px]">
            <div className="mb-3.5 flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground">
                Ticket queue
              </h2>
              <Link
                href="/dashboard/tickets"
                className="text-[13px] font-medium text-accent-text"
              >
                View all
              </Link>
            </div>
            <div className="mb-1.5 grid grid-cols-3 gap-2.5">
              <TicketTile
                value={counts.open}
                label="Open"
                valueClass="text-status-pending"
              />
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
            </div>
            {queueTickets.length === 0 ? (
              <p className="border-t border-divider pt-3 text-[13px] text-quiet">
                No tickets yet.
              </p>
            ) : (
              queueTickets.map((t) => (
                <TicketRow
                  key={t.id}
                  title={t.title}
                  meta={`${ticketSource(t)} · ${shortAge(t.created_at, nowMs)} ago`}
                  status={t.status as TicketStatus}
                />
              ))
            )}
          </Card>

          <Card className="px-5 py-[18px]">
            <h2 className="mb-1.5 text-base font-semibold text-foreground">
              Activity
            </h2>
            {activity.length === 0 ? (
              <p className="border-t border-divider pt-3 text-[13px] text-quiet">
                Nothing has happened yet.
              </p>
            ) : (
              activity.map((item) => (
                <ActivityRow key={item.key} item={item} nowMs={nowMs} />
              ))
            )}
          </Card>

          <Link
            href="/dashboard/help"
            className="flex items-center gap-3 rounded-button border border-(--accent-outline) bg-field px-4 py-[13px] transition-colors hover:bg-card-hover"
          >
            <span className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-[8px] bg-accent-gradient">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--primary-foreground)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 3l1.5 5.1L18.5 9.5 13.5 11 12 16l-1.5-5L5.5 9.5 10.5 8.1z" />
              </svg>
            </span>
            <span className="flex-1 text-sm text-quiet">
              Ask Talvex about anything on your systems
            </span>
            <span className="flex-none text-[13px] font-semibold text-accent-text">
              Open
            </span>
          </Link>
        </div>
      </div>
    </main>
  )
}
