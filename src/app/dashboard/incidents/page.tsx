import Link from 'next/link'

import { StatusMark } from '@/components/status-mark'
import { requireAdmin } from '@/lib/auth/org-viewer'
import { listIncidents, type IncidentListItem } from '@/lib/db/incidents'

import { Card } from '../_overview/ui'
import { formatUtc } from '../monitors/ui'
import { elapsedSince, formatDuration, resolvedWithin } from './ui'

export const metadata = { title: 'Incidents — Talvex' }

/**
 * The incidents screen, restyled to the handoff (Phase 1 Task 2 data). Server
 * component: rows come through the org scoped layer, so RLS has filtered them.
 * Open incidents as cards, then the ones resolved this week. Everything shown
 * is real: monitor, how long it has been down, and the real reopen count.
 * SLA countdown, blast radius, last fix, and Notify/Assign/Acknowledge have no
 * data source (design open questions 3, 4, 6, 7) and are left out, not faked.
 * Admin only (requireAdmin); members never see incidents.
 */
export default async function IncidentsPage() {
  await requireAdmin()
  const { open, resolved } = await listIncidents()
  const nowMs = new Date().getTime()
  const resolvedWeek = resolvedWithin(resolved, nowMs)
  const empty = open.length === 0 && resolvedWeek.length === 0

  return (
    <main id="main-content" className="mx-auto w-full max-w-[1360px] flex-1 animate-fade-up px-8 pt-[30px] pb-[72px]">
      <div className="mb-[22px]">
        <h1 className="text-title text-foreground">Incidents</h1>
        <p className="mt-1.5 text-[14px] text-quiet">
          {open.length} open · {resolvedWeek.length} resolved this week
        </p>
      </div>

      {empty ? (
        <Card className="max-w-xl p-8">
          <h2 className="text-base font-semibold text-card-foreground">
            No incidents
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            When a monitor fails two checks in a row, an incident opens here with
            a timeline of what happened. When the monitor recovers, it resolves on
            its own. Nothing has gone down this week.
          </p>
        </Card>
      ) : (
        <>
          {open.length > 0 ? (
            <>
              <div className="mb-3 text-section text-quiet uppercase">Open</div>
              <div className="mb-[30px] grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-[18px]">
                {open.map((i) => (
                  <OpenIncidentCard key={i.id} i={i} />
                ))}
              </div>
            </>
          ) : null}

          {resolvedWeek.length > 0 ? (
            <>
              <div className="mb-3 text-section text-quiet uppercase">
                Resolved this week
              </div>
              <Card className="pb-2">
                {resolvedWeek.map((r) => (
                  <ResolvedRow key={r.id} r={r} />
                ))}
              </Card>
            </>
          ) : null}
        </>
      )}
    </main>
  )
}

function OpenIncidentCard({ i }: { i: IncidentListItem }) {
  return (
    <Card className="px-[22px] pt-5 pb-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-base font-semibold text-foreground">
            {i.monitorName}
          </span>
          {i.reopenCount > 0 ? (
            <span className="flex-none rounded-full bg-tile px-2 py-0.5 text-[10.5px] font-medium text-chip-text">
              reopened {i.reopenCount}×
            </span>
          ) : null}
        </span>
        <span className="whitespace-nowrap font-mono text-[13px] text-status-down">
          Down {elapsedSince(i.opened_at)}
        </span>
      </div>
      <div className="mt-1.5 font-mono text-[12px] text-quiet">
        opened {formatUtc(i.opened_at)}
      </div>
      {/* TODO(design open questions 3, 4, 6, 7): SLA countdown, blast radius,
          last fix / runbook, and Notify / Assign / Acknowledge have no data
          source or schema. The card frame is built; those lines are omitted
          rather than faked. The real action is opening the incident. */}
      <div className="mt-3 flex justify-end">
        <Link
          href={`/dashboard/incidents/${i.id}`}
          className="text-[13px] font-semibold text-accent-text"
        >
          View incident
        </Link>
      </div>
    </Card>
  )
}

function ResolvedRow({ r }: { r: IncidentListItem }) {
  const durationMs = r.resolved_at
    ? Date.parse(r.resolved_at) - Date.parse(r.opened_at)
    : 0
  return (
    <div className="flex items-center gap-3.5 border-t border-divider px-[22px] py-3.5 first:border-t-0">
      {/* Bare mark on purpose: this row lives under the "Resolved this week"
          heading, so the state is already in words above it. */}
      <StatusMark tone="up" size={9} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">{r.monitorName}</div>
        {r.reopenCount > 0 ? (
          <div className="mt-0.5 text-[12.5px] text-quiet">
            reopened {r.reopenCount}× before resolving
          </div>
        ) : null}
      </div>
      <div className="flex-none text-right">
        <div className="font-mono text-[13px] text-status-up">
          Resolved in {formatDuration(durationMs)}
        </div>
        {r.resolved_at ? (
          <div className="mt-0.5 font-mono text-[12px] text-quiet">
            {formatUtc(r.resolved_at)}
          </div>
        ) : null}
      </div>
    </div>
  )
}
