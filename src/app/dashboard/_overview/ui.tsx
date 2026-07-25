import Link from 'next/link'

import type { IncidentListItem } from '@/lib/db/incidents'
import type { MonitorOverviewItem } from '@/lib/db/monitors'
import type { TicketStatus } from '@/lib/db/types'

import { formatUptime, monitorStatus, primaryButton, type StatusKind } from '../monitors/ui'
import { TicketStatusBadge } from '../tickets/ui'
import {
  barKind,
  shortAge,
  sparklineGeometry,
  type ActivityItem,
  type Verdict,
} from './lib'

/**
 * Presentational pieces of the Overview. All server rendered: nothing here is
 * interactive, so none of it is a client component. Every value comes from the
 * page's real data; where the design shows a number with no source yet, the
 * piece simply does not render it (a marked TODO sits at the call site).
 */

const DOT: Record<StatusKind, string> = {
  up: 'bg-status-up',
  down: 'bg-status-down',
  pending: 'bg-status-pending',
  paused: 'bg-quiet',
}
const TEXT: Record<StatusKind, string> = {
  up: 'text-status-up',
  down: 'text-status-down',
  pending: 'text-status-pending',
  paused: 'text-quiet',
}
const LABEL: Record<StatusKind, string> = {
  up: 'Up',
  down: 'Down',
  pending: 'Pending',
  paused: 'Paused',
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

export function Card({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <section
      className={`rounded-card border border-card-border bg-card shadow-[var(--shadow-card)] ${className}`}
    >
      {children}
    </section>
  )
}

/** Segmented mini bar under a KPI number (up/down/paused split, etc.). */
export function SegBar({
  segments,
}: {
  segments: Array<{ value: number; className: string }>
}) {
  const shown = segments.filter((s) => s.value > 0)
  if (shown.length === 0) return null
  return (
    <div className="flex h-2.5 w-full gap-[3px]">
      {shown.map((s, i) => (
        <span
          key={i}
          className={`min-w-[4px] rounded-[3px] ${s.className}`}
          style={{ flexGrow: s.value, flexBasis: 0 }}
        />
      ))}
    </div>
  )
}

export function KpiCard({
  label,
  value,
  unit,
  valueClass = 'text-foreground',
  sub,
  viz,
}: {
  label: string
  value: string
  unit?: string
  valueClass?: string
  sub?: string
  viz?: React.ReactNode
}) {
  return (
    <div className="flex min-h-[96px] flex-col rounded-kpi border border-card-border bg-card px-[18px] pt-4 pb-2 shadow-[var(--shadow-card)]">
      <div className="text-[13px] font-medium text-quiet">{label}</div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className={`text-kpi ${valueClass}`}>{value}</span>
        {unit ? <span className="text-sm font-medium text-quiet">{unit}</span> : null}
      </div>
      {sub ? <div className="mt-2 text-[12.5px] text-quiet">{sub}</div> : null}
      {viz ? <div className="mt-auto flex h-[22px] items-end pt-2.5">{viz}</div> : null}
    </div>
  )
}

export function Sparkline({ points }: { points: number[] }) {
  const geo = sparklineGeometry(points)
  if (!geo) {
    return <span className="text-[11px] text-quiet">Not enough history yet</span>
  }
  return (
    <svg
      viewBox="0 0 200 40"
      preserveAspectRatio="none"
      className="block h-full w-full"
      aria-hidden
    >
      <defs>
        <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--muted-foreground)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--muted-foreground)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={geo.area} fill="url(#spark-fill)" />
      <path
        d={geo.line}
        fill="none"
        stroke="var(--muted-foreground)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** A compact latency line (stroke only, no gradient, so it is safe to repeat
 * on every row). Real response times; renders nothing below two points. */
export function MiniSpark({ points }: { points: number[] }) {
  const geo = sparklineGeometry(points, 200, 24)
  if (!geo) return null
  return (
    <svg
      viewBox="0 0 200 24"
      preserveAspectRatio="none"
      className="block h-[13px] w-full"
      aria-hidden
    >
      <path
        d={geo.line}
        fill="none"
        stroke="var(--muted-foreground)"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity="0.7"
      />
    </svg>
  )
}

/** The 40 bar recent checks strip. Real checks only; empty until a monitor has
 * been checked. */
export function UptimeStrip({
  checks,
  paused,
}: {
  checks: Array<{ status: string }>
  paused: boolean
}) {
  if (checks.length === 0) {
    return (
      <div className="flex h-[26px] items-center text-[11px] text-quiet">
        No checks yet
      </div>
    )
  }
  return (
    <div className="flex h-[26px] items-end gap-[1.5px] overflow-hidden">
      {checks.map((c, i) => {
        const kind = paused ? 'paused' : barKind(c.status)
        const tone =
          kind === 'up'
            ? 'bg-status-up opacity-[.82]'
            : kind === 'down'
              ? 'bg-status-down'
              : kind === 'pending'
                ? 'bg-status-pending'
                : 'bg-quiet/40'
        const height = kind === 'paused' ? 'h-[38%]' : 'h-full'
        return (
          <span
            key={i}
            className={`min-w-0 flex-1 rounded-[1px] ${height} ${tone}`}
          />
        )
      })}
    </div>
  )
}

/** The status dot: colored by kind, pulsing only when down. Shared across the
 * overview panel and the monitors table. */
export function StatusDot({ status }: { status: StatusKind }) {
  return (
    <span
      aria-hidden
      className={`h-[9px] w-[9px] flex-none rounded-full ${DOT[status]} ${
        status === 'down' ? 'animate-[pulseDot_1.8s_ease-in-out_infinite]' : ''
      }`}
    />
  )
}

export function MonitorRow({
  m,
  nowMs,
}: {
  m: MonitorOverviewItem
  nowMs: number
}) {
  const status = monitorStatus(m)
  const lastChecked = m.last_checked_at
    ? `${shortAge(m.last_checked_at, nowMs)} ago`
    : 'no checks yet'
  return (
    <div className="flex items-center gap-3 border-t border-divider px-5 py-[13px]">
      <StatusDot status={status} />
      <div className="w-[146px] flex-none">
        <div className="truncate text-[14.5px] font-medium text-foreground">
          {m.name}
        </div>
        <div className="mt-0.5 truncate font-mono text-[12px] text-quiet">
          {hostOf(m.url)} · {lastChecked}
        </div>
      </div>
      <div className="min-w-[40px] flex-1">
        <UptimeStrip checks={m.recentChecks} paused={status === 'paused'} />
      </div>
      <div className="w-[132px] flex-none pr-1 text-right">
        <div className="whitespace-nowrap text-[13.5px] font-medium">
          <span className={TEXT[status]}>{LABEL[status]}</span>
          {status === 'up' && m.lastResponseMs !== null ? (
            <span className="font-mono text-muted-foreground">
              {' · '}
              {m.lastResponseMs} ms
            </span>
          ) : null}
        </div>
        {m.uptimePercent30d !== null ? (
          <div className="mt-0.5 whitespace-nowrap font-mono text-[12px] text-quiet">
            {formatUptime(m.uptimePercent30d)} uptime
          </div>
        ) : null}
      </div>
    </div>
  )
}

function AlertIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--status-down)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}
function CheckIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="var(--status-up)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

export function VerdictBanner({
  verdict,
  actionHref,
}: {
  verdict: Verdict
  actionHref: string
}) {
  const down = verdict.tone === 'down'
  return (
    <Card className="flex items-center gap-5 px-6 py-5">
      <div
        className={`flex h-12 w-12 flex-none items-center justify-center rounded-tile ${
          down ? 'bg-wash-down' : 'bg-wash-up'
        }`}
      >
        {down ? <AlertIcon /> : <CheckIcon />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[20px] font-semibold tracking-[-0.015em] text-foreground">
          {verdict.title}
        </div>
        <div className="mt-1 text-[14.5px] text-pretty text-muted-foreground">
          {verdict.subtitle}
        </div>
      </div>
      {down ? (
        <Link href={actionHref} className={`${primaryButton} flex-none`}>
          View incidents
        </Link>
      ) : null}
    </Card>
  )
}

export function IncidentItem({
  i,
  nowMs,
}: {
  i: IncidentListItem
  nowMs: number
}) {
  return (
    <div className="border-t border-divider py-3.5 first:border-t-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[14.5px] font-medium text-foreground">
            {i.monitorName}
          </span>
          {i.reopenCount > 0 ? (
            <span className="flex-none rounded-full bg-tile px-2 py-0.5 text-[10.5px] font-medium text-chip-text">
              reopened {i.reopenCount}×
            </span>
          ) : null}
        </span>
        <span className="whitespace-nowrap font-mono text-[13px] text-status-down">
          Down {shortAge(i.opened_at, nowMs)}
        </span>
      </div>
      {/* TODO(design open questions 3, 4, 6, 7): the SLA countdown, blast radius
          ("Affects ~N people"), last fix / runbook link, and Notify / Assign /
          Acknowledge actions have no data source or schema yet. The card frame
          is built; those lines are omitted rather than shown with fake values.
          The real action available today is opening the incident. */}
      <div className="mt-3 flex items-center justify-end">
        <Link
          href={`/dashboard/incidents/${i.id}`}
          className="text-[13px] font-semibold text-accent-text"
        >
          View incident
        </Link>
      </div>
    </div>
  )
}

export function NoIncidents({
  lastResolvedAt,
  nowMs,
}: {
  lastResolvedAt: string | null
  nowMs: number
}) {
  return (
    <div className="py-4 text-center">
      <div className="mx-auto mb-2.5 flex h-[38px] w-[38px] items-center justify-center rounded-full bg-wash-up">
        <CheckIcon size={19} />
      </div>
      <div className="text-sm font-medium text-foreground">No open incidents</div>
      <div className="mt-0.5 text-[12.5px] text-quiet">
        Nothing needs you right now.
      </div>
      {lastResolvedAt ? (
        <div className="mt-2.5 font-mono text-[12px] text-quiet">
          Last incident {shortAge(lastResolvedAt, nowMs)} ago
        </div>
      ) : null}
    </div>
  )
}

export function TicketTile({
  value,
  label,
  valueClass,
}: {
  value: number
  label: string
  valueClass: string
}) {
  return (
    <div className="rounded-mini border border-card-border bg-tile p-3">
      <div className={`text-[22px] font-semibold leading-none ${valueClass}`}>
        {value}
      </div>
      <div className="mt-1.5 text-[12px] text-quiet">{label}</div>
    </div>
  )
}

export function TicketRow({
  title,
  meta,
  status,
}: {
  title: string
  meta: string
  status: TicketStatus
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-divider py-3">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-foreground">{title}</div>
        <div className="mt-0.5 text-[12px] text-quiet">{meta}</div>
      </div>
      <div className="flex-none">
        <TicketStatusBadge status={status} />
      </div>
    </div>
  )
}

export function ActivityRow({
  item,
  nowMs,
}: {
  item: ActivityItem
  nowMs: number
}) {
  const dot =
    item.tone === 'up'
      ? 'bg-status-up'
      : item.tone === 'down'
        ? 'bg-status-down'
        : 'bg-accent-text'
  return (
    <div className="flex items-center gap-2.5 border-t border-divider py-2.5 first:border-t-0">
      <span className={`h-2 w-2 flex-none rounded-full ${dot}`} aria-hidden />
      <div className="min-w-0 flex-1 text-[13px] text-pretty text-secondary-foreground">
        {item.text}
      </div>
      <span className="flex-none whitespace-nowrap font-mono text-[12px] text-quiet">
        {shortAge(item.at, nowMs)}
      </span>
    </div>
  )
}
