import { createOrgScopedClient } from './client'
import { OrgNotSyncedError } from './monitors'
import type { AiProvider } from './types'

/**
 * Typed data layer for usage metering (BRD F11, CLAUDE.md code rule 7).
 * DISPLAY ONLY: everything here is read side aggregation over tables other
 * features already write (chat_messages from the chat route, and
 * monitor_daily_rollups from the cron sweep), plus a live seat count from
 * org_members. Nothing is limited, gated, or billed, and no new
 * instrumentation is added anywhere.
 *
 * Every query runs on the org scoped client, so RLS has filtered rows to the
 * caller's org before any code here sees them. There is no service role
 * anywhere in this module. Note the chat_messages select policy: an org admin
 * sees every conversation's messages, a member sees only their own. The usage
 * screen is admin only, so the admin reading here sees the whole org.
 *
 * Aggregation happens in this process rather than in SQL on purpose: at MVP
 * scale a two month message window and 30 days of rollups are small, and a
 * usage rollup table mirroring the monitor pattern is the Phase 2 move when
 * metering starts feeding billing.
 */

/** The zone stored when browser detection yields nothing valid. */
export const DEFAULT_TIMEZONE = 'America/New_York'

/**
 * Shape gate mirroring the organizations_timezone_format check constraint in
 * migration 012: Area/Location segments, or the literal UTC. The runtime
 * check in isValidTimezone is the authority; this keeps the server from ever
 * accepting a value the database would then refuse.
 */
const TIMEZONE_FORMAT = /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)+$/
const TIMEZONE_MAX_LENGTH = 64

/** Input validation failed. Safe to display on the settings form. */
export class TimezoneValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TimezoneValidationError'
  }
}

/**
 * True when tz is an IANA zone name this runtime can actually bucket months
 * by: sane shape (the migration 012 constraint), sane length, and accepted by
 * Intl.DateTimeFormat, which throws on zones the runtime does not know.
 */
export function isValidTimezone(tz: string): boolean {
  if (tz.length === 0 || tz.length > TIMEZONE_MAX_LENGTH) return false
  if (tz !== 'UTC' && !TIMEZONE_FORMAT.test(tz)) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Month bucketing in the org timezone. Pure and exported for the unit suite.
// chat_messages.created_at is a UTC instant; the org month it belongs to is
// decided by the wall clock in the org's one authoritative zone, so a message
// sent late on July 31 in New York (already August 1 in UTC) still counts as
// July there, and a message sent in the early Tokyo hours of July 1 (still
// June 30 in UTC) counts as July in Tokyo.

/** The wall clock in a zone at a UTC instant, read back as numbers. */
function wallClockParts(ms: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(ms))
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? NaN)
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  }
}

/** The zone's UTC offset at an instant, in milliseconds. */
function zoneOffsetMs(ms: number, timeZone: string): number {
  const w = wallClockParts(ms, timeZone)
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second)
  // Round to whole seconds: formatToParts carries no milliseconds.
  return asUtc - Math.floor(ms / 1000) * 1000
}

/** The calendar year and month (1 to 12) an instant falls in, in a zone. */
export function zonedYearMonth(
  ms: number,
  timeZone: string,
): { year: number; month: number } {
  const w = wallClockParts(ms, timeZone)
  return { year: w.year, month: w.month }
}

/**
 * The UTC instant at which a calendar month begins in a zone: local midnight
 * on the 1st. Two pass offset math, the standard technique: guess the answer
 * as if the zone were UTC, correct by the offset there, then correct once
 * more in case the first correction crossed a daylight saving change.
 */
export function monthStartUtcMs(
  year: number,
  month: number,
  timeZone: string,
): number {
  const localMidnight = Date.UTC(year, month - 1, 1)
  const first = localMidnight - zoneOffsetMs(localMidnight, timeZone)
  return localMidnight - zoneOffsetMs(first, timeZone)
}

export type MonthRange = {
  year: number
  month: number
  /** 'YYYY-MM', a stable key for the month. */
  key: string
  /** 'July 2026', for the screen. */
  label: string
  /** UTC instant the month begins in the org zone, inclusive. */
  startMs: number
  /** UTC instant the next month begins in the org zone, exclusive. */
  endMs: number
}

export function monthRange(
  year: number,
  month: number,
  timeZone: string,
): MonthRange {
  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  return {
    year,
    month,
    key: `${year}-${String(month).padStart(2, '0')}`,
    label: new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'long',
    }).format(new Date(Date.UTC(year, month - 1, 15))),
    startMs: monthStartUtcMs(year, month, timeZone),
    endMs: monthStartUtcMs(nextYear, nextMonth, timeZone),
  }
}

/** The current and previous org zone months at an instant. */
export function currentAndPreviousMonth(
  nowMs: number,
  timeZone: string,
): { current: MonthRange; previous: MonthRange } {
  const { year, month } = zonedYearMonth(nowMs, timeZone)
  const prevYear = month === 1 ? year - 1 : year
  const prevMonth = month === 1 ? 12 : month - 1
  return {
    current: monthRange(year, month, timeZone),
    previous: monthRange(prevYear, prevMonth, timeZone),
  }
}

// ---------------------------------------------------------------------------
// AI usage aggregation. What is counted, per the migration 008 schema:
// chat_messages holds user rows and assistant rows. Assistant rows carry
// provider, model, and the token counts; user rows never do (enforced by the
// chat_messages_role_fields constraint). So the month's message count is ALL
// rows, user and assistant alike, while the per provider rows and every token
// sum can only come from assistant rows, because a user row has no provider
// to attribute it to.

/** The columns the aggregation reads from chat_messages. */
export type UsageMessageRow = {
  role: string
  provider: string | null
  input_tokens: number | null
  output_tokens: number | null
  created_at: string
}

export type ProviderUsage = {
  provider: AiProvider
  /** Assistant messages answered by this provider. */
  messages: number
  inputTokens: number
  outputTokens: number
}

export type MonthUsage = {
  key: string
  label: string
  /** All messages in the month, user and assistant. */
  messageCount: number
  userMessageCount: number
  assistantMessageCount: number
  inputTokens: number
  outputTokens: number
  providers: ProviderUsage[]
}

/** Stable display order; only providers with activity are returned. */
const PROVIDER_ORDER: AiProvider[] = ['anthropic', 'openai', 'google']

export function aggregateMessages(
  rows: UsageMessageRow[],
  range: MonthRange,
): MonthUsage {
  const byProvider = new Map<AiProvider, ProviderUsage>()
  let userCount = 0
  let assistantCount = 0
  let inputTokens = 0
  let outputTokens = 0

  for (const row of rows) {
    const at = Date.parse(row.created_at)
    if (at < range.startMs || at >= range.endMs) continue
    if (row.role === 'user') {
      userCount++
      continue
    }
    assistantCount++
    inputTokens += row.input_tokens ?? 0
    outputTokens += row.output_tokens ?? 0
    const provider = row.provider as AiProvider | null
    if (!provider) continue
    const entry = byProvider.get(provider) ?? {
      provider,
      messages: 0,
      inputTokens: 0,
      outputTokens: 0,
    }
    entry.messages++
    entry.inputTokens += row.input_tokens ?? 0
    entry.outputTokens += row.output_tokens ?? 0
    byProvider.set(provider, entry)
  }

  const providers = PROVIDER_ORDER.filter((p) => byProvider.has(p)).map(
    (p) => byProvider.get(p)!,
  )
  return {
    key: range.key,
    label: range.label,
    messageCount: userCount + assistantCount,
    userMessageCount: userCount,
    assistantMessageCount: assistantCount,
    inputTokens,
    outputTokens,
    providers,
  }
}

// ---------------------------------------------------------------------------
// Monitor checks. Read entirely from monitor_daily_rollups, which the cron
// sweep already maintains per monitor per UTC day; no new instrumentation.
//
// Known and accepted skew, stated once here and disclosed on the screen:
// rollup days are UTC buckets and the raw checks behind them are pruned after
// 30 days, so a check day cannot be rebucketed into the org zone. Each UTC
// day is treated as a day. The 30 day series is honest as "last 30 days", and
// the month total sums the UTC dates that share the org month's calendar
// label, which can differ from the org zone month by a few hours at each
// edge. Display only counts do not warrant instrumenting checks to fix this.

export type ChecksUsage = {
  /** One entry per UTC day, oldest first, zero filled: last 30 days. */
  days: Array<{ day: string; count: number }>
  last30DaysTotal: number
  /** Sum over UTC dates carrying the current month's calendar label. */
  monthTotal: number
}

export type UsageRollupRow = {
  day: string
  check_count: number
}

/** The UTC date 'YYYY-MM-DD' of an instant. */
function utcDateString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function aggregateChecks(
  rows: UsageRollupRow[],
  nowMs: number,
  currentMonthKey: string,
): ChecksUsage {
  const perDay = new Map<string, number>()
  let monthTotal = 0
  for (const row of rows) {
    perDay.set(row.day, (perDay.get(row.day) ?? 0) + row.check_count)
    if (row.day.startsWith(currentMonthKey)) monthTotal += row.check_count
  }

  const days: Array<{ day: string; count: number }> = []
  let last30DaysTotal = 0
  for (let back = 29; back >= 0; back--) {
    const day = utcDateString(nowMs - back * 86_400_000)
    const count = perDay.get(day) ?? 0
    days.push({ day, count })
    last30DaysTotal += count
  }
  return { days, last30DaysTotal, monthTotal }
}

// ---------------------------------------------------------------------------
// Seats. A live count over org_members at read time, never a stored number.
// "Admins" is the same set the admin gate recognizes (owner and admin, the
// is_org_admin definition); technicians and members count as members.

export type SeatCounts = {
  admins: number
  members: number
  total: number
}

export function countSeats(rows: Array<{ role: string }>): SeatCounts {
  let admins = 0
  for (const row of rows) {
    if (row.role === 'owner' || row.role === 'admin') admins++
  }
  return { admins, members: rows.length - admins, total: rows.length }
}

// ---------------------------------------------------------------------------
// Reads and the one write.

export type UsageOverview = {
  /** The zone every number below is bucketed by. */
  timezone: string
  /** False while organizations.timezone is still NULL (first visit). */
  timezoneStored: boolean
  currentMonth: MonthUsage
  previousMonth: MonthUsage
  checks: ChecksUsage
  seats: SeatCounts
}

/**
 * PostgREST caps a response at 1000 rows, so reads that can exceed it page
 * with .range() until a short page arrives. Small helper to keep the loop in
 * one place.
 */
const PAGE_SIZE = 1000
async function pageThrough<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
): Promise<T[]> {
  const all: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const page = await fetchPage(from, from + PAGE_SIZE - 1)
    all.push(...page)
    if (page.length < PAGE_SIZE) return all
  }
}

/**
 * The one entry point for the usage screen: everything it renders, in one
 * shaped object, bucketed by the org's stored timezone. While the zone is
 * unset (first ever visit, before the client detects and saves the browser
 * zone) the caller may pass the zone to render with; absent that, the
 * DEFAULT_TIMEZONE fallback applies so the first paint never blocks.
 */
export async function getUsageOverview(
  opts: { fallbackTimezone?: string; now?: Date } = {},
): Promise<UsageOverview> {
  const { client, orgId } = await createOrgScopedClient()

  const { data: org, error: orgErr } = await client
    .from('organizations')
    .select('timezone')
    .eq('clerk_org_id', orgId)
    .maybeSingle()
  if (orgErr) throw orgErr
  if (!org) throw new OrgNotSyncedError()

  const timezone = org.timezone ?? opts.fallbackTimezone ?? DEFAULT_TIMEZONE
  const nowMs = (opts.now ?? new Date()).getTime()
  const { current, previous } = currentAndPreviousMonth(nowMs, timezone)

  // One message window covering both months, paged past the row cap, then
  // bucketed here. The window is small at MVP scale; see the module comment
  // for the Phase 2 rollup table plan.
  const windowStart = new Date(previous.startMs).toISOString()
  const windowEnd = new Date(current.endMs).toISOString()
  const messages = await pageThrough<UsageMessageRow>(async (from, to) => {
    const { data, error } = await client
      .from('chat_messages')
      .select('role, provider, input_tokens, output_tokens, created_at')
      .gte('created_at', windowStart)
      .lt('created_at', windowEnd)
      .order('created_at', { ascending: true })
      .range(from, to)
    if (error) throw error
    return data
  })

  // Rollups back to whichever is older: 30 days ago, or the 1st of the
  // current month by UTC date label (the accepted skew; see above).
  const thirtyDaysAgo = utcDateString(nowMs - 29 * 86_400_000)
  const monthFirstDay = `${current.key}-01`
  const rollupsFrom =
    monthFirstDay < thirtyDaysAgo ? monthFirstDay : thirtyDaysAgo
  const rollups = await pageThrough<UsageRollupRow>(async (from, to) => {
    const { data, error } = await client
      .from('monitor_daily_rollups')
      .select('day, check_count')
      .gte('day', rollupsFrom)
      .order('day', { ascending: true })
      .range(from, to)
    if (error) throw error
    return data
  })

  const { data: members, error: membersErr } = await client
    .from('org_members')
    .select('role')
  if (membersErr) throw membersErr

  return {
    timezone,
    timezoneStored: org.timezone !== null,
    currentMonth: aggregateMessages(messages, current),
    previousMonth: aggregateMessages(messages, previous),
    checks: aggregateChecks(rollups, nowMs, current.key),
    seats: countSeats(members),
  }
}

/**
 * Validates and stores the org timezone. RLS makes the write admin only
 * (migration 012): for anyone else the update matches zero rows and the
 * stored zone is unchanged. The saved value is the only zone the aggregation
 * ever uses from then on, and the zone Phase 2 billing will use.
 */
export async function saveOrgTimezone(
  timezone: string,
  opts: { onlyIfUnset?: boolean } = {},
): Promise<void> {
  const tz = timezone.trim()
  if (!isValidTimezone(tz)) {
    throw new TimezoneValidationError(
      'That is not a timezone this server recognizes. Pick one from the list.',
    )
  }
  const { client, orgId } = await createOrgScopedClient()
  let query = client
    .from('organizations')
    .update({ timezone: tz })
    .eq('clerk_org_id', orgId)
  if (opts.onlyIfUnset) {
    // The zero setup auto save: lands only while the column is still NULL,
    // so a concurrent admin's stored zone is never overwritten.
    query = query.is('timezone', null)
  }
  const { error } = await query
  if (error) throw error
}

/** The zones the runtime supports, for the settings select. */
export function supportedTimezones(): string[] {
  return Intl.supportedValuesOf('timeZone')
}
