import Link from 'next/link'

import { requireAdmin } from '@/lib/auth/org-viewer'
import { listMonitorsWithRecentChecks } from '@/lib/db/monitors'

import { MiniSpark, StatusDot, UptimeStrip } from '../_overview/ui'
import { shortAge } from '../_overview/lib'
import {
  STATUS_LABEL,
  STATUS_TEXT,
  formatInterval,
  formatUptime,
  monitorStatus,
  primaryButton,
} from './ui'

export const metadata = { title: 'Monitors — Talvex' }

const GRID = 'grid grid-cols-[minmax(0,1fr)_200px_148px_88px_96px] gap-3.5'

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/**
 * The monitors list, restyled to the handoff (Phase 1 Task 1 data). Server
 * component: rows come through the org scoped data layer, so RLS has already
 * filtered them to the active organization. The recent checks strip is real
 * check history; a monitor with no checks says so. Admin only (requireAdmin).
 */
export default async function MonitorsPage() {
  await requireAdmin()
  const monitors = await listMonitorsWithRecentChecks()
  const nowMs = new Date().getTime()

  const withStatus = monitors.map((m) => ({ m, status: monitorStatus(m) }))
  const up = withStatus.filter((x) => x.status === 'up').length
  const down = withStatus.filter((x) => x.status === 'down').length
  const paused = withStatus.filter((x) => x.status === 'paused').length

  return (
    <main className="mx-auto w-full max-w-[1360px] flex-1 animate-fade-up px-8 pt-[30px] pb-[72px]">
      <div className="mb-[22px] flex flex-wrap items-end justify-between gap-5">
        <div>
          <h1 className="text-title text-foreground">Monitors</h1>
          <p className="mt-1.5 text-[14px] text-quiet">
            {up} up · {down} down · {paused} paused · updated just now
          </p>
        </div>
        {monitors.length > 0 ? (
          <Link href="/dashboard/monitors/new" className={primaryButton}>
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
            Add monitor
          </Link>
        ) : null}
      </div>

      {monitors.length === 0 ? (
        <div className="flex max-w-xl flex-col items-start gap-4 rounded-card border border-card-border bg-card p-8 shadow-card">
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
        <section className="overflow-hidden rounded-card border border-card-border bg-card pb-2 shadow-card">
          <div
            className={`${GRID} px-[22px] py-3.5 text-column text-quiet uppercase`}
          >
            <span>Monitor</span>
            <span>Recent checks · latency</span>
            <span className="text-right">Response</span>
            <span className="text-right">Uptime</span>
            <span className="text-right">Interval</span>
          </div>
          {withStatus.map(({ m, status }) => (
            <div
              key={m.id}
              className={`${GRID} items-center border-t border-divider px-[22px] py-[13px]`}
            >
              <div className="flex min-w-0 items-center gap-3">
                <StatusDot status={status} />
                <div className="min-w-0">
                  <Link
                    href={`/dashboard/monitors/${m.id}`}
                    className="truncate text-[14.5px] font-medium text-foreground hover:text-accent-text"
                  >
                    {m.name}
                  </Link>
                  <div className="mt-0.5 truncate font-mono text-[12px] text-quiet">
                    {hostOf(m.url)}
                    {m.last_checked_at
                      ? ` · ${shortAge(m.last_checked_at, nowMs)} ago`
                      : ' · no checks yet'}
                  </div>
                </div>
              </div>
              <div className="min-w-0">
                <UptimeStrip checks={m.recentChecks} paused={status === 'paused'} />
                {status !== 'paused' ? (
                  <div className="mt-1">
                    <MiniSpark
                      points={m.recentChecks
                        .map((c) => c.responseMs)
                        .filter((n): n is number => n !== null)}
                    />
                  </div>
                ) : null}
              </div>
              <div className="text-right text-[13.5px] font-medium whitespace-nowrap">
                <span className={STATUS_TEXT[status]}>{STATUS_LABEL[status]}</span>
                {status === 'up' && m.lastResponseMs !== null ? (
                  <span className="font-mono text-muted-foreground">
                    {' · '}
                    {m.lastResponseMs} ms
                  </span>
                ) : null}
              </div>
              <div className="text-right font-mono text-[13px] text-muted-foreground">
                {formatUptime(m.uptimePercent30d)}
              </div>
              <div className="text-right text-[12.5px] text-quiet">
                {formatInterval(m.interval_seconds)}
              </div>
            </div>
          ))}
        </section>
      )}
    </main>
  )
}
