import { describe, expect, it } from 'vitest'

import {
  aggregateChecks,
  aggregateMessages,
  countSeats,
  currentAndPreviousMonth,
  isValidTimezone,
  monthRange,
  monthStartUtcMs,
  zonedYearMonth,
  type UsageMessageRow,
} from '@/lib/db/usage'

// Unit suite for the F11 usage aggregation helpers. All pure: month
// bucketing in the org timezone, timezone validation, provider grouping,
// check day summing, and seat counting. No database and no mocks needed;
// the data layer entry point only feeds rows into these.

const msg = (over: Partial<UsageMessageRow> = {}): UsageMessageRow => ({
  role: 'assistant',
  provider: 'anthropic',
  input_tokens: 100,
  output_tokens: 50,
  created_at: '2026-07-10T12:00:00Z',
  ...over,
})

describe('month bucketing in the org timezone', () => {
  it('keeps a late evening New York message in the local month, not the UTC one', () => {
    // July 31, 11:30pm in New York is already August 1, 03:30 UTC. The org
    // month is decided by the New York wall clock, so this is July.
    const july = monthRange(2026, 7, 'America/New_York')
    const at = Date.parse('2026-08-01T03:30:00Z')
    expect(at).toBeGreaterThanOrEqual(july.startMs)
    expect(at).toBeLessThan(july.endMs)
    expect(zonedYearMonth(at, 'America/New_York')).toEqual({
      year: 2026,
      month: 7,
    })
  })

  it('puts an early Tokyo morning into the new month while UTC is still in the old one', () => {
    // June 30, 16:00 UTC is July 1, 01:00 in Tokyo: July there, June in UTC.
    const july = monthRange(2026, 7, 'Asia/Tokyo')
    const at = Date.parse('2026-06-30T16:00:00Z')
    expect(at).toBeGreaterThanOrEqual(july.startMs)
    expect(zonedYearMonth(at, 'Asia/Tokyo')).toEqual({ year: 2026, month: 7 })
    // And the same instant is still June in UTC.
    expect(zonedYearMonth(at, 'UTC')).toEqual({ year: 2026, month: 6 })
  })

  it('crosses the daylight saving fall back without losing or doubling an hour', () => {
    // US daylight saving ends November 1, 2026. Local midnight November 1 is
    // still EDT (UTC minus 4); local midnight December 1 is EST (UTC minus
    // 5). November in New York is therefore 30 days plus one hour long.
    expect(monthStartUtcMs(2026, 11, 'America/New_York')).toBe(
      Date.UTC(2026, 10, 1, 4),
    )
    expect(monthStartUtcMs(2026, 12, 'America/New_York')).toBe(
      Date.UTC(2026, 11, 1, 5),
    )
    const nov = monthRange(2026, 11, 'America/New_York')
    expect(nov.endMs - nov.startMs).toBe(30 * 86_400_000 + 3_600_000)
  })

  it('crosses the spring forward the other way: March is an hour short', () => {
    const mar = monthRange(2026, 3, 'America/New_York')
    expect(mar.startMs).toBe(Date.UTC(2026, 2, 1, 5))
    expect(mar.endMs).toBe(Date.UTC(2026, 3, 1, 4))
    expect(mar.endMs - mar.startMs).toBe(31 * 86_400_000 - 3_600_000)
  })

  it('labels and keys the month', () => {
    const july = monthRange(2026, 7, 'Asia/Tokyo')
    expect(july.key).toBe('2026-07')
    expect(july.label).toBe('July 2026')
  })

  it('wraps the previous month across the year boundary', () => {
    const at = Date.UTC(2026, 0, 15, 12)
    const { current, previous } = currentAndPreviousMonth(at, 'UTC')
    expect(current.key).toBe('2026-01')
    expect(previous.key).toBe('2025-12')
  })
})

describe('isValidTimezone', () => {
  it('accepts real IANA zones and UTC', () => {
    expect(isValidTimezone('America/New_York')).toBe(true)
    expect(isValidTimezone('Asia/Tokyo')).toBe(true)
    expect(isValidTimezone('America/Argentina/Buenos_Aires')).toBe(true)
    expect(isValidTimezone('UTC')).toBe(true)
  })

  it('refuses garbage', () => {
    expect(isValidTimezone('')).toBe(false)
    expect(isValidTimezone('garbage')).toBe(false)
    expect(isValidTimezone('America/')).toBe(false)
    expect(isValidTimezone('EST')).toBe(false)
    expect(isValidTimezone("America/New_York'; drop table organizations;--")).toBe(
      false,
    )
    expect(isValidTimezone('A'.repeat(65))).toBe(false)
  })

  it('refuses a zone with a plausible shape the runtime does not know', () => {
    // Passes the format gate, so only the runtime check can catch it.
    expect(isValidTimezone('Not/AZone')).toBe(false)
  })
})

describe('aggregateMessages', () => {
  const july = monthRange(2026, 7, 'UTC')

  it('groups assistant messages by provider and counts user messages in the total', () => {
    const rows: UsageMessageRow[] = [
      msg({ role: 'user', provider: null, input_tokens: null, output_tokens: null }),
      msg(),
      msg({ role: 'user', provider: null, input_tokens: null, output_tokens: null }),
      msg({ provider: 'openai', input_tokens: 30, output_tokens: 20 }),
      msg({ input_tokens: 10, output_tokens: 5 }),
    ]
    const out = aggregateMessages(rows, july)
    expect(out.messageCount).toBe(5)
    expect(out.userMessageCount).toBe(2)
    expect(out.assistantMessageCount).toBe(3)
    expect(out.inputTokens).toBe(140)
    expect(out.outputTokens).toBe(75)
    expect(out.providers).toEqual([
      { provider: 'anthropic', messages: 2, inputTokens: 110, outputTokens: 55 },
      { provider: 'openai', messages: 1, inputTokens: 30, outputTokens: 20 },
    ])
  })

  it('excludes messages outside the month range', () => {
    const rows = [
      msg({ created_at: '2026-06-30T23:59:59Z' }),
      msg({ created_at: '2026-07-01T00:00:00Z' }),
      msg({ created_at: '2026-08-01T00:00:00Z' }),
    ]
    const out = aggregateMessages(rows, july)
    expect(out.messageCount).toBe(1)
  })

  it('returns the zero shape for an empty org', () => {
    expect(aggregateMessages([], july)).toEqual({
      key: '2026-07',
      label: 'July 2026',
      messageCount: 0,
      userMessageCount: 0,
      assistantMessageCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      providers: [],
    })
  })
})

describe('aggregateChecks', () => {
  const now = Date.UTC(2026, 6, 28, 12)

  it('sums monitors per day, zero fills 30 days, and totals the labeled month', () => {
    const rows = [
      { day: '2026-07-27', check_count: 100 },
      { day: '2026-07-27', check_count: 40 },
      { day: '2026-07-01', check_count: 10 },
      { day: '2026-06-30', check_count: 7 },
    ]
    const out = aggregateChecks(rows, now, '2026-07')
    expect(out.days).toHaveLength(30)
    expect(out.days[0]).toEqual({ day: '2026-06-29', count: 0 })
    expect(out.days[29]).toEqual({ day: '2026-07-28', count: 0 })
    expect(out.days.find((d) => d.day === '2026-07-27')).toEqual({
      day: '2026-07-27',
      count: 140,
    })
    expect(out.last30DaysTotal).toBe(157)
    // June 30 sits inside the 30 day window but outside the July label.
    expect(out.monthTotal).toBe(150)
  })

  it('a month with zero messages but nonzero checks still reports the checks', () => {
    const empty = aggregateMessages([], monthRange(2026, 7, 'UTC'))
    const checks = aggregateChecks([{ day: '2026-07-20', check_count: 288 }], now, '2026-07')
    expect(empty.messageCount).toBe(0)
    expect(checks.monthTotal).toBe(288)
    expect(checks.last30DaysTotal).toBe(288)
  })

  it('returns 30 zero days for an org with no rollups', () => {
    const out = aggregateChecks([], now, '2026-07')
    expect(out.days).toHaveLength(30)
    expect(out.days.every((d) => d.count === 0)).toBe(true)
    expect(out.last30DaysTotal).toBe(0)
    expect(out.monthTotal).toBe(0)
  })
})

describe('countSeats', () => {
  it('counts owners and admins as admins, everyone else as members', () => {
    const out = countSeats([
      { role: 'owner' },
      { role: 'admin' },
      { role: 'technician' },
      { role: 'member' },
      { role: 'member' },
    ])
    expect(out).toEqual({ admins: 2, members: 3, total: 5 })
  })

  it('returns zeros for an empty org', () => {
    expect(countSeats([])).toEqual({ admins: 0, members: 0, total: 0 })
  })
})
