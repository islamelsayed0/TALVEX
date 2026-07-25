/**
 * Pure Overview logic, kept apart from the server component so it renders from
 * real data deterministically and a test can exercise it without a database.
 * Nothing here invents a value: every function maps data the page already
 * fetched. Where the design shows a number with no source yet (SLA, blast
 * radius, recurrence window, last fix), the page leaves an honest gap, not a
 * call into here.
 */

export function partOfDay(hour: number): 'morning' | 'afternoon' | 'evening' {
  if (hour < 12) return 'morning'
  if (hour < 18) return 'afternoon'
  return 'evening'
}

/** Server rendered, so the hour is the server's (UTC on Vercel). A per user
 * timezone would sharpen this; it is a preference, not one of the 8 open
 * questions, so it stays server time for now. */
export function greeting(now: Date, name: string): string {
  return `Good ${partOfDay(now.getUTCHours())}, ${name}`
}

/** Join names the way the sentence reads: "A", "A and B", "A, B and C". */
export function joinNames(names: string[]): string {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`
}

export type Verdict = { tone: 'down' | 'clear'; title: string; subtitle: string }

export function deriveVerdict(input: {
  downNames: string[]
  openIncidents: number
  openTickets: number
  upCount: number
}): Verdict {
  const { downNames, openIncidents, openTickets, upCount } = input
  const down = downNames.length

  if (down > 0) {
    const title =
      down === 1 ? 'One system is down' : `${down} systems are down`
    const openParts: string[] = []
    if (openIncidents > 0) {
      openParts.push(`${openIncidents} ${plural(openIncidents, 'incident')}`)
    }
    if (openTickets > 0) {
      openParts.push(`${openTickets} ${plural(openTickets, 'ticket')}`)
    }
    const tail = openParts.length
      ? ` ${joinNames(openParts)} ${openParts.length === 1 && openIncidents + openTickets === 1 ? 'is' : 'are'} open.`
      : ''
    return {
      tone: 'down',
      title,
      subtitle: `${joinNames(downNames)} ${down === 1 ? 'needs' : 'need'} attention.${tail}`,
    }
  }

  const ticketLine =
    openTickets > 0
      ? `${openTickets} ${plural(openTickets, 'ticket')} ${openTickets === 1 ? 'is' : 'are'} waiting on you.`
      : 'Nothing is waiting on you.'
  return {
    tone: 'clear',
    title: 'All systems are operational',
    subtitle: `${upCount} ${plural(upCount, 'monitor')} up. No open incidents. ${ticketLine}`,
  }
}

export function ticketSource(t: {
  incident_id: string | null
  conversation_id: string | null
}): string {
  if (t.incident_id) return 'From incident'
  if (t.conversation_id) return 'From chat'
  return 'Manual'
}

export type TicketCounts = {
  open: number
  inProgress: number
  resolvedToday: number
  closed: number
}

function startOfUtcDay(nowMs: number): number {
  const d = new Date(nowMs)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

export function summarizeTickets(
  tickets: Array<{ status: string; resolved_at: string | null }>,
  nowMs: number,
): TicketCounts {
  const dayStart = startOfUtcDay(nowMs)
  const counts: TicketCounts = {
    open: 0,
    inProgress: 0,
    resolvedToday: 0,
    closed: 0,
  }
  for (const t of tickets) {
    if (t.status === 'open') counts.open++
    else if (t.status === 'in_progress') counts.inProgress++
    else if (t.status === 'closed') counts.closed++
    if (
      t.status === 'resolved' &&
      t.resolved_at &&
      Date.parse(t.resolved_at) >= dayStart
    ) {
      counts.resolvedToday++
    }
  }
  return counts
}

/** A check outcome mapped to a bar kind for the uptime strip. */
export function barKind(status: string): 'up' | 'down' | 'pending' {
  if (status === 'up') return 'up'
  if (status === 'down') return 'down'
  return 'pending'
}

/** Compact relative age: 8s, 14m, 2h, 6d. */
export function shortAge(iso: string, nowMs: number): string {
  const s = Math.max(0, Math.floor((nowMs - Date.parse(iso)) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

/** SVG path pair for the sparkline, or null when there is too little history
 * to draw a line (the caller then shows an honest empty state). */
export function sparklineGeometry(
  points: number[],
  w = 200,
  h = 40,
): { line: string; area: string } | null {
  if (points.length < 2) return null
  const max = Math.max(...points)
  const min = Math.min(...points)
  const range = max - min || 1
  const coords = points.map((p, i) => [
    (i / (points.length - 1)) * w,
    h - 3 - ((p - min) / range) * (h - 8),
  ])
  const line =
    'M' + coords.map((c) => `${c[0].toFixed(1)},${c[1].toFixed(1)}`).join(' L')
  return { line, area: `${line} L${w},${h} L0,${h} Z` }
}

export type ActivityItem = {
  key: string
  text: string
  tone: 'up' | 'down' | 'accent'
  at: string
}

/** The activity feed, built from incidents and tickets the page already has.
 * No new query and nothing synthesized: each row is a real event with a real
 * timestamp. */
export function buildActivity(
  input: {
    openIncidents: Array<{ id: string; monitorName: string; opened_at: string }>
    resolvedIncidents: Array<{
      id: string
      monitorName: string
      resolved_at: string | null
    }>
    tickets: Array<{
      id: string
      title: string
      created_at: string
      incident_id: string | null
    }>
  },
  limit = 6,
): ActivityItem[] {
  const items: ActivityItem[] = []
  for (const i of input.openIncidents) {
    items.push({
      key: `inc-open-${i.id}`,
      text: `${i.monitorName} went down`,
      tone: 'down',
      at: i.opened_at,
    })
  }
  for (const i of input.resolvedIncidents) {
    if (!i.resolved_at) continue
    items.push({
      key: `inc-res-${i.id}`,
      text: `${i.monitorName} recovered`,
      tone: 'up',
      at: i.resolved_at,
    })
  }
  for (const t of input.tickets) {
    items.push({
      key: `tkt-${t.id}`,
      text: `Ticket opened: ${t.title}${t.incident_id ? ' (from an incident)' : ''}`,
      tone: 'accent',
      at: t.created_at,
    })
  }
  return items
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, limit)
}
