import { zoneOffsetMs, zonedWallClock } from '@/lib/db/usage'
import type { TrailItem } from '@/lib/db/tickets'

/**
 * The daily digest: one email per org per day, at a time the org chooses, in
 * the org's own timezone, listing what needs attention today. This module is
 * pure. It decides WHEN a digest is due and WHAT it says; the cron route does
 * the service role reads and the sending, exactly the split dispatch.ts and
 * the sweep already use for incident alerts.
 *
 * Three rulings live in here rather than in the schema or the route:
 *
 *   1. Quiet days send nothing. composeDigest returns null when every section
 *      is empty, so there is no all clear email to suppress later: it never
 *      exists. An email arriving means something needs attention, and the
 *      settings copy promises exactly that.
 *
 *   2. Content is titles, names, counts, ages, and links, and nothing else.
 *      No ticket body, no comment text, no article content, no inventory
 *      notes. The gathering side honours this by never selecting those
 *      columns at all, so there is no body in memory to leak into a subject
 *      line by accident.
 *
 *   3. The send time is a wall clock time in organizations.timezone (F11, the
 *      one authority). 07:30 is their 07:30 across daylight saving, because
 *      the due check reads the local wall clock at the current instant rather
 *      than doing arithmetic on a stored offset.
 */

// ---------------------------------------------------------------------------
// Due check: is this org's digest due right now, and for which local day?

/** How the settings row reaches the due check. */
export type DigestSchedule = {
  /** organizations.timezone, or the app default when the org has none yet. */
  timeZone: string
  /** digest_send_time as PostgREST returns it: 'HH:MM:SS' or 'HH:MM'. */
  sendTime: string
  /** digest_last_sent_on, an org local 'YYYY-MM-DD', or null before the first. */
  lastSentOn: string | null
}

export type DigestDueCheck = {
  due: boolean
  /** The org local date now, 'YYYY-MM-DD'. The value to stamp after a send. */
  today: string
  /** Minutes past org local midnight, for the tests and for logging. */
  localMinutes: number
}

/** 'HH:MM' or 'HH:MM:SS' as minutes past midnight, or null if unparseable. */
export function parseSendTime(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  const seconds = Number(match[3] ?? '0')
  if (hours > 23 || minutes > 59 || seconds !== 0) return null
  return hours * 60 + minutes
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Whether the digest is due for this org at this instant.
 *
 * Due means both: the org's local clock has reached the chosen time today, and
 * no digest has been stamped for the org's local today. The sweep runs every 5
 * minutes, so "at or past" rather than "equals" is what makes a 07:30 setting
 * land at 07:30 or shortly after instead of being missed entirely whenever no
 * sweep happens to fall on that exact minute.
 *
 * Daylight saving needs no special case. The local wall clock is read from the
 * instant through the zone, so on the day a zone springs forward the local
 * clock jumps 01:59 to 03:00 and a 02:30 setting becomes due at 03:00, on the
 * first sweep after the jump. It cannot be skipped, and the ledger stops the
 * repeated hour in autumn from sending twice.
 *
 * An unparseable send time is treated as not due rather than as midnight: a
 * value the app cannot read is a reason to stay quiet, not to email everyone
 * at once.
 */
export function digestDueCheck(
  schedule: DigestSchedule,
  nowMs: number,
): DigestDueCheck {
  const clock = zonedWallClock(nowMs, schedule.timeZone)
  const today = isoDate(clock.year, clock.month, clock.day)
  const localMinutes = clock.hour * 60 + clock.minute

  const sendMinutes = parseSendTime(schedule.sendTime)
  if (sendMinutes === null) return { due: false, today, localMinutes }

  const alreadySentToday =
    schedule.lastSentOn !== null && schedule.lastSentOn >= today
  return {
    due: localMinutes >= sendMinutes && !alreadySentToday,
    today,
    localMinutes,
  }
}

/**
 * The UTC instant a local wall clock time falls at in a zone. Two pass offset
 * math, the monthStartUtcMs technique: guess as if the zone were UTC, correct
 * by the offset there, then correct once more in case the first correction
 * crossed a daylight saving change.
 */
function zonedLocalToUtcMs(
  localDate: string,
  minutesPastMidnight: number,
  timeZone: string,
): number {
  const [year, month, day] = localDate.split('-').map(Number)
  const asIfUtc = Date.UTC(year, month - 1, day, 0, minutesPastMidnight)
  const first = asIfUtc - zoneOffsetMs(asIfUtc, timeZone)
  return asIfUtc - zoneOffsetMs(first, timeZone)
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The instant this digest's window opens: when the previous digest went out,
 * or 24 hours ago when there was no previous one. Everything reported as new
 * arrived at or after it.
 */
export function digestWindowStartMs(
  schedule: DigestSchedule,
  nowMs: number,
): number {
  const sendMinutes = parseSendTime(schedule.sendTime)
  if (schedule.lastSentOn === null || sendMinutes === null) return nowMs - DAY_MS
  return zonedLocalToUtcMs(schedule.lastSentOn, sendMinutes, schedule.timeZone)
}

// ---------------------------------------------------------------------------
// Awaiting a reply.
//
// The ruling defines it as "the last trail entry is from the requester side",
// and the existing shape does make that ambiguous, so this is the reading,
// stated once here and repeated in the PR description.
//
// A ticket's trail (interleaveTrail, reused rather than reinvented) carries two
// kinds of entry: comments, which are what people actually say to each other,
// and system events, which are 'created', 'status_changed' and 'auto_closed'.
// Only comments are replies. A status change is bookkeeping: an admin moving a
// ticket to in_progress has told the requester nothing, so counting it as a
// reply would silently drop the ticket out of the digest while the person who
// opened it is still waiting to hear back. Suppressing is the dangerous
// direction, so events are skipped and the last COMMENT decides.
//
// A ticket with no comments at all is awaiting a reply. The requester has
// asked and nobody has answered, which is the plainest case there is.
//
// INTERNAL NOTES ARE NOT REPLIES (migration 019). An admin writing a note the
// requester cannot see has told them nothing, so counting it would drop the
// ticket off the digest while the person who opened it is still waiting, which
// is precisely the failure the paragraph above exists to prevent. The rule is
// the same one, applied to a new kind of entry: only something the requester
// can actually read counts as an answer.
//
// This is enforced twice on purpose. The digest runs on the service role, which
// bypasses RLS, so internal notes WOULD come back from the query; the sweep
// filters them out at the source, and the functions below skip any that reach
// them anyway. Two guards because a silent miss here is invisible: the symptom
// is an email that quietly stops mentioning a waiting ticket.

/**
 * The trail as the digest reads it: the shared TrailItem, narrowed to the only
 * columns this feature selects. Comment bodies are absent by construction, so
 * there is no content in memory here for an email to leak (ruling 5).
 */
type DigestComment = {
  author: string
  created_at: string
  is_internal?: boolean
}

export type DigestTrailItem = TrailItem<DigestComment, { occurred_at: string }>

/**
 * The comment on this trail entry, when it is one the requester can actually
 * read. Null for a system event and null for an internal note, which are the
 * two kinds of entry that tell the requester nothing.
 */
function readableComment(item: DigestTrailItem): DigestComment | null {
  if (item.kind !== 'comment') return null
  if (item.comment.is_internal === true) return null
  return item.comment
}

/** True when the last thing said on this ticket came from the requester. */
export function isAwaitingReply(
  submittedBy: string,
  trail: DigestTrailItem[],
): boolean {
  for (let i = trail.length - 1; i >= 0; i--) {
    const comment = readableComment(trail[i])
    if (comment === null) continue
    return comment.author === submittedBy
  }
  return true
}

/**
 * Since when this ticket has been waiting: the last thing the requester said,
 * or the ticket's creation when they have said nothing since opening it. This
 * is the age the digest reports, because "waiting 2d" is the number that
 * decides what to pick up, not how long ago the ticket happened to be filed.
 */
export function waitingSinceMs(
  ticket: { submittedBy: string; createdAtIso: string },
  trail: DigestTrailItem[],
): number {
  for (let i = trail.length - 1; i >= 0; i--) {
    const comment = readableComment(trail[i])
    if (comment === null) continue
    if (comment.author === ticket.submittedBy) {
      return Date.parse(comment.created_at)
    }
    // An admin answered after them, so they are not the one waiting.
    break
  }
  return Date.parse(ticket.createdAtIso)
}

// ---------------------------------------------------------------------------
// Composition.

export type DigestIncident = {
  incidentId: string
  monitorName: string
  openedAtIso: string
}

export type DigestTicket = {
  ticketId: string
  title: string
  /** The instant the age is measured from: waiting since, or arrival. */
  sinceIso: string
}

export type DigestCertificate = {
  monitorId: string
  monitorName: string
  /** Calendar days in the org zone. 0 is today; negative is already expired. */
  daysLeft: number
}

export type DigestLowStockItem = {
  itemId: string
  name: string
  quantity: number
  minStock: number
}

/**
 * One section: the rows the email lists, and how many there really are.
 *
 * The two differ when a section is longer than the email should be. An email
 * listing four hundred tickets is not a briefing, so the gathering side caps
 * what it lists, and total stays the true count. Every count the reader sees,
 * in the subject and in each heading, comes from total; a capped section says
 * plainly how many more there are and links to the full list. Nothing is
 * silently dropped.
 */
export type DigestSection<T> = { items: T[]; total: number }

/** How many rows one section lists before it says "and N more" instead. */
export const DIGEST_SECTION_LIMIT = 15

/** Caps a gathered list into a section, keeping the true total. */
export function digestSection<T>(all: T[]): DigestSection<T> {
  return { items: all.slice(0, DIGEST_SECTION_LIMIT), total: all.length }
}

/** Everything the composition needs, already narrowed to one org. */
export type DigestData = {
  openIncidents: DigestSection<DigestIncident>
  expiringCertificates: DigestSection<DigestCertificate>
  awaitingReply: DigestSection<DigestTicket>
  newTickets: DigestSection<DigestTicket>
  lowStock: DigestSection<DigestLowStockItem>
}

export type DigestEmail = { subject: string; text: string }

/** "4m", "1h 12m", "2d 4h". The incidents screen wording, kept identical. */
export function formatAge(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'under a minute'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/** Trailing slashes off, so joining a route never doubles the separator. */
function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`
}

/**
 * The subject line. Counts are always real. Sections that are empty are
 * absent from the phrasing entirely rather than reported as zero, and at most
 * the two most important present sections appear, so the line stays readable
 * in a mail list on a phone. The body carries the rest.
 */
export function digestSubject(data: DigestData): string {
  const parts: string[] = []
  if (data.openIncidents.total > 0) {
    parts.push(plural(data.openIncidents.total, 'incident', 'incidents'))
  }
  if (data.expiringCertificates.total > 0) {
    parts.push(
      `${plural(data.expiringCertificates.total, 'certificate', 'certificates')} expiring`,
    )
  }
  if (data.awaitingReply.total > 0) {
    parts.push(`${plural(data.awaitingReply.total, 'ticket', 'tickets')} waiting`)
  }
  if (data.newTickets.total > 0) {
    parts.push(plural(data.newTickets.total, 'new ticket', 'new tickets'))
  }
  if (data.lowStock.total > 0) {
    parts.push(`${plural(data.lowStock.total, 'item', 'items')} low on stock`)
  }
  return `[Talvext] Your day: ${parts.slice(0, 2).join(', ')}`
}

/**
 * The digest for one org, or null when there is nothing to say.
 *
 * Null IS the quiet day ruling, decided here at composition rather than at
 * send: a caller that gets null has no email to send, so there is no path on
 * which an all clear could go out.
 *
 * Every line that names something links to it at its real dashboard route, so
 * the email is a set of starting points rather than a report to read and then
 * go looking. Plain text, like the incident emails.
 */
export function composeDigest(
  data: DigestData,
  opts: { baseUrl: string; nowMs: number },
): DigestEmail | null {
  const empty =
    data.openIncidents.total === 0 &&
    data.expiringCertificates.total === 0 &&
    data.awaitingReply.total === 0 &&
    data.newTickets.total === 0 &&
    data.lowStock.total === 0
  if (empty) return null

  const link = (path: string) => `  ${joinUrl(opts.baseUrl, path)}`
  const lines: string[] = ['Here is what needs your attention today.']

  /** Heading, rows, and the honest tail when a section was capped. */
  function section<T>(
    heading: string,
    part: DigestSection<T>,
    listPath: string,
    row: (item: T) => string,
    idOf: (item: T) => string,
    itemPath: (id: string) => string,
  ): void {
    if (part.total === 0) return
    lines.push('', `${heading} (${part.total})`)
    for (const item of part.items) {
      lines.push('', `  ${row(item)}`)
      lines.push(link(itemPath(idOf(item))))
    }
    const hidden = part.total - part.items.length
    if (hidden > 0) {
      lines.push('', `  and ${plural(hidden, 'more', 'more')}`)
      lines.push(link(listPath))
    }
  }

  const age = (iso: string) => formatAge(opts.nowMs - Date.parse(iso))

  /** "3 days left", "1 day left", "expires today", "expired". */
  const certRow = (c: DigestCertificate) => {
    if (c.daysLeft < 0) return `${c.monitorName}, certificate expired`
    if (c.daysLeft === 0) return `${c.monitorName}, certificate expires today`
    return `${c.monitorName}, ${plural(c.daysLeft, 'day', 'days')} left`
  }

  section(
    'Open incidents',
    data.openIncidents,
    '/dashboard/incidents',
    (i) => `${i.monitorName}, down ${age(i.openedAtIso)}`,
    (i) => i.incidentId,
    (id) => `/dashboard/incidents/${id}`,
  )
  section(
    'Certificates expiring soon',
    data.expiringCertificates,
    '/dashboard/monitors',
    certRow,
    (c) => c.monitorId,
    (id) => `/dashboard/monitors/${id}`,
  )
  section(
    'Tickets waiting on a reply',
    data.awaitingReply,
    '/dashboard/tickets',
    (t) => `${t.title}, waiting ${age(t.sinceIso)}`,
    (t) => t.ticketId,
    (id) => `/dashboard/tickets/${id}`,
  )
  section(
    'New tickets',
    data.newTickets,
    '/dashboard/tickets',
    (t) => `${t.title}, ${age(t.sinceIso)} ago`,
    (t) => t.ticketId,
    (id) => `/dashboard/tickets/${id}`,
  )
  section(
    'Low on stock',
    data.lowStock,
    '/dashboard/inventory',
    (i) => `${i.name}, ${i.quantity} in stock, minimum ${i.minStock}`,
    (i) => i.itemId,
    (id) => `/dashboard/inventory/${id}`,
  )

  lines.push(
    '',
    '',
    'You are seeing this because the daily digest is on for your organization.',
    'On a day with nothing to report, this email does not arrive at all.',
    'Change the time or turn it off in Settings, under Notifications.',
    link('/dashboard/settings/notifications'),
  )

  return { subject: digestSubject(data), text: lines.join('\n') }
}
