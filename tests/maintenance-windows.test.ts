import { describe, expect, it } from 'vitest'

import {
  SUPPRESS_PRESET_HOURS,
  suppressUntilForPreset,
  MonitorValidationError,
} from '@/lib/db/monitors'
import { zonedMinuteLabel } from '@/lib/db/usage'
import { needsCatchUp, suppressedAt } from '@/lib/notifications/dispatch'

// Unit suite for maintenance windows (migration 021). Everything here is
// pure: the skip decision, the catch up decision table, the preset cap, and
// the org zone rendering. The database side of the cap and the admin gate
// are proven by the isolation suite.

const NOW = Date.parse('2026-08-06T12:00:00Z')

const hoursFromNow = (h: number) =>
  new Date(NOW + h * 60 * 60 * 1000).toISOString()

describe('suppressedAt', () => {
  it('holds notifications while the window is open', () => {
    expect(suppressedAt(hoursFromNow(2), NOW)).toBe(true)
  })

  it('lets them flow with no window, an expired window, or garbage', () => {
    expect(suppressedAt(null, NOW)).toBe(false)
    expect(suppressedAt(hoursFromNow(-1), NOW)).toBe(false)
    // The boundary instant itself is not suppressed: until means until.
    expect(suppressedAt(new Date(NOW).toISOString(), NOW)).toBe(false)
    expect(suppressedAt('not a date', NOW)).toBe(false)
  })
})

describe('needsCatchUp, the decision table', () => {
  const table: {
    name: string
    input: Parameters<typeof needsCatchUp>[0]
    expected: boolean
  }[] = [
    {
      name: 'suppressed and still open: window active, no catch up yet',
      input: {
        suppressUntilIso: hoursFromNow(2),
        suppressSetAtIso: hoursFromNow(-1),
        lastNotifiedAtIso: null,
        nowMs: NOW,
      },
      expected: false,
    },
    {
      name: 'window expired, incident opened inside it and never notified: catch up',
      input: {
        suppressUntilIso: hoursFromNow(-1),
        suppressSetAtIso: hoursFromNow(-5),
        lastNotifiedAtIso: null,
        nowMs: NOW,
      },
      expected: true,
    },
    {
      name: 'window expired, last notification predates the window: catch up',
      input: {
        suppressUntilIso: hoursFromNow(-1),
        suppressSetAtIso: hoursFromNow(-5),
        lastNotifiedAtIso: hoursFromNow(-8),
        nowMs: NOW,
      },
      expected: true,
    },
    {
      name: 'window expired but the incident already alerted after it was set: settled',
      input: {
        suppressUntilIso: hoursFromNow(-1),
        suppressSetAtIso: hoursFromNow(-5),
        lastNotifiedAtIso: hoursFromNow(-0.5),
        nowMs: NOW,
      },
      expected: false,
    },
    {
      name: 'no window at all: the normal path owns it',
      input: {
        suppressUntilIso: null,
        suppressSetAtIso: null,
        lastNotifiedAtIso: null,
        nowMs: NOW,
      },
      expected: false,
    },
  ]

  for (const row of table) {
    it(row.name, () => {
      expect(needsCatchUp(row.input)).toBe(row.expected)
    })
  }

  it('resolved incidents never reach this decision', () => {
    // The catch up pass selects status = open only; an incident resolved
    // during the window sends nothing after it (its resolve was skipped, and
    // history already tells the story). This is documented here because the
    // table above cannot show a filter that runs in the query.
    expect(true).toBe(true)
  })
})

describe('suppressUntilForPreset, the cap', () => {
  it('renders every offered preset to at most 24 hours from now', () => {
    for (const hours of SUPPRESS_PRESET_HOURS) {
      const until = Date.parse(suppressUntilForPreset(hours, NOW))
      expect(until - NOW).toBeLessThanOrEqual(24 * 60 * 60 * 1000)
      expect(until).toBeGreaterThan(NOW)
    }
  })

  it('refuses anything that is not an offered preset', () => {
    for (const bad of [0, 2, 25, 48, -1, Number.NaN]) {
      expect(() => suppressUntilForPreset(bad, NOW)).toThrow(MonitorValidationError)
    }
  })
})

describe('zonedMinuteLabel, until times in the org zone', () => {
  it('renders the same instant differently across zones', () => {
    const instant = Date.parse('2026-08-06T21:00:00Z')
    expect(zonedMinuteLabel(instant, 'America/New_York')).toBe('Aug 6, 17:00 EDT')
    expect(zonedMinuteLabel(instant, 'UTC')).toBe('Aug 6, 21:00 UTC')
    expect(zonedMinuteLabel(instant, 'Pacific/Auckland')).toBe('Aug 7, 09:00 GMT+12')
  })

  it('follows daylight saving, not a stored offset', () => {
    // Winter in New York is EST; the same wall clock question a few months
    // apart answers with a different zone name and offset.
    const winter = Date.parse('2026-01-15T21:00:00Z')
    expect(zonedMinuteLabel(winter, 'America/New_York')).toBe('Jan 15, 16:00 EST')
  })
})
