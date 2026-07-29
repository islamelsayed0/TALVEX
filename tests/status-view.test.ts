import { describe, expect, it } from 'vitest'

import {
  aggregateUptime,
  buildHeatmap,
  deriveOverallState,
  formatUptime,
  heatmapTone,
  isValidStatusSlug,
  lastDays,
} from '../src/lib/status/status-view'

describe('isValidStatusSlug (mirrors the migration 011 check constraint)', () => {
  it('accepts lowercase segments joined by single hyphens', () => {
    expect(isValidStatusSlug('acme')).toBe(true)
    expect(isValidStatusSlug('acme-status')).toBe(true)
    expect(isValidStatusSlug('a1b2-c3')).toBe(true)
  })
  it('rejects uppercase', () => {
    expect(isValidStatusSlug('Acme')).toBe(false)
  })
  it('rejects leading and trailing hyphens', () => {
    expect(isValidStatusSlug('-acme')).toBe(false)
    expect(isValidStatusSlug('acme-')).toBe(false)
  })
  it('rejects double hyphens', () => {
    expect(isValidStatusSlug('acme--status')).toBe(false)
  })
  it('rejects too short and too long', () => {
    expect(isValidStatusSlug('ab')).toBe(false)
    expect(isValidStatusSlug('a'.repeat(64))).toBe(false)
    expect(isValidStatusSlug('a'.repeat(63))).toBe(true)
  })
  it('rejects unicode and spaces', () => {
    expect(isValidStatusSlug('café')).toBe(false)
    expect(isValidStatusSlug('my status')).toBe(false)
  })
})

describe('deriveOverallState', () => {
  it('is operational when nothing is down', () => {
    const s = deriveOverallState([{ last_status: 'up' }, { last_status: null }])
    expect(s.operational).toBe(true)
    expect(s.label).toBe('All systems operational')
  })
  it('counts down monitors, singular and plural', () => {
    expect(deriveOverallState([{ last_status: 'down' }, { last_status: 'up' }]).label).toBe(
      '1 monitor down',
    )
    expect(
      deriveOverallState([{ last_status: 'down' }, { last_status: 'down' }]).label,
    ).toBe('2 monitors down')
  })
  it('handles an empty org', () => {
    const s = deriveOverallState([])
    expect(s.total).toBe(0)
    expect(s.label).toBe('No monitors yet')
  })
  it('does not count a never-checked monitor as down', () => {
    expect(deriveOverallState([{ last_status: null }]).operational).toBe(true)
  })
})

describe('formatUptime', () => {
  it('shows a clean integer and trims trailing zeros', () => {
    expect(formatUptime(100)).toBe('100%')
    expect(formatUptime(99.5)).toBe('99.5%')
    expect(formatUptime(99.98)).toBe('99.98%')
    expect(formatUptime(99.5)).not.toBe('99.50%')
  })
})

describe('aggregateUptime', () => {
  it('weights each day by its check count', () => {
    // 100% over 100 checks, 0% over 100 checks → 50%.
    expect(
      aggregateUptime([
        { uptime_percent: 100, check_count: 100 },
        { uptime_percent: 0, check_count: 100 },
      ]),
    ).toBe(50)
  })
  it('is null with no rollups', () => {
    expect(aggregateUptime([])).toBeNull()
  })
})

describe('heatmapTone', () => {
  it('buckets uptime and treats no data as none', () => {
    expect(heatmapTone(null)).toBe('none')
    expect(heatmapTone(100)).toBe('up')
    expect(heatmapTone(99.999)).toBe('up')
    expect(heatmapTone(97)).toBe('partial')
    expect(heatmapTone(80)).toBe('down')
  })
})

describe('lastDays and buildHeatmap', () => {
  it('returns count consecutive UTC days ending at the reference', () => {
    const days = lastDays('2026-07-28', 3)
    expect(days).toEqual(['2026-07-26', '2026-07-27', '2026-07-28'])
  })
  it('maps rollups onto days and leaves gaps as none', () => {
    const cells = buildHeatmap(
      [{ day: '2026-07-27', uptime_percent: 99.5 }],
      '2026-07-28',
      3,
    )
    // 99.5% is partial, not up: the up bucket is 99.99% and above.
    expect(cells.map((c) => c.tone)).toEqual(['none', 'partial', 'none'])
    expect(cells[1].uptime).toBe(99.5)
  })
})
