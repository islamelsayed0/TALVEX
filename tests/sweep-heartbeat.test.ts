import { describe, expect, it } from 'vitest'

import {
  buildHeartbeatPayload,
  sweepBannerCopy,
  sweepFreshness,
  sweepIsStale,
  SWEEP_STALE_AFTER_SECONDS,
} from '@/lib/monitoring/heartbeat'

/**
 * The freshness decision table. Every function here takes the instant it
 * reasons about, so none of this needs a clock or a database.
 *
 * The case that matters most is the boundary: the sweep runs every 300
 * seconds and the threshold is 900, so a single late invocation must not read
 * as an outage. A banner that flaps is a banner people learn to ignore.
 */

const NOW = Date.parse('2026-07-30T12:00:00.000Z')

/** An ISO timestamp `seconds` before NOW. */
function ago(seconds: number): string {
  return new Date(NOW - seconds * 1000).toISOString()
}

describe('sweepFreshness', () => {
  it('reports never when the sweep has not stamped yet', () => {
    expect(sweepFreshness(null, NOW)).toEqual({ state: 'never' })
  })

  it('reports never rather than throwing when the stored value is unparseable', () => {
    expect(sweepFreshness('not a timestamp', NOW)).toEqual({ state: 'never' })
  })

  it('is fresh immediately after a sweep', () => {
    expect(sweepFreshness(ago(0), NOW)).toEqual({ state: 'fresh', ageSeconds: 0 })
  })

  it('is still fresh after one missed sweep', () => {
    expect(sweepFreshness(ago(600), NOW)).toEqual({ state: 'fresh', ageSeconds: 600 })
  })

  it('is fresh one second before the threshold', () => {
    const f = sweepFreshness(ago(SWEEP_STALE_AFTER_SECONDS - 1), NOW)
    expect(f.state).toBe('fresh')
  })

  it('is stale exactly at the threshold', () => {
    const f = sweepFreshness(ago(SWEEP_STALE_AFTER_SECONDS), NOW)
    expect(f).toEqual({ state: 'stale', ageSeconds: SWEEP_STALE_AFTER_SECONDS })
  })

  it('is stale long after', () => {
    expect(sweepFreshness(ago(86_400), NOW)).toEqual({ state: 'stale', ageSeconds: 86_400 })
  })

  it('clamps a future timestamp to zero rather than reporting a negative age', () => {
    // Clock skew between the database and the runtime should read as brand new.
    expect(sweepFreshness(ago(-120), NOW)).toEqual({ state: 'fresh', ageSeconds: 0 })
  })
})

describe('sweepIsStale', () => {
  it('treats never as stale, because an unproven sweep is not a running one', () => {
    expect(sweepIsStale({ state: 'never' })).toBe(true)
    expect(sweepIsStale({ state: 'stale', ageSeconds: 1000 })).toBe(true)
    expect(sweepIsStale({ state: 'fresh', ageSeconds: 10 })).toBe(false)
  })
})

describe('sweepBannerCopy', () => {
  it('renders nothing at all when the sweep is fresh', () => {
    expect(sweepBannerCopy({ state: 'fresh', ageSeconds: 30 })).toBeNull()
  })

  it('distinguishes a deployment that has never run from one that stopped', () => {
    const never = sweepBannerCopy({ state: 'never' })
    expect(never?.title).toBe('Monitoring has not reported yet')
    expect(never?.subtitle).not.toContain('CRON_SECRET')
  })

  it('names the age in whole minutes', () => {
    expect(sweepBannerCopy({ state: 'stale', ageSeconds: 47 * 60 })?.title).toBe(
      'Monitoring has not run in 47 minutes',
    )
  })

  it('uses singular units where they read correctly', () => {
    expect(sweepBannerCopy({ state: 'stale', ageSeconds: 60 })?.title).toBe(
      'Monitoring has not run in 1 minute',
    )
    expect(sweepBannerCopy({ state: 'stale', ageSeconds: 3600 })?.title).toBe(
      'Monitoring has not run in 1 hour',
    )
    expect(sweepBannerCopy({ state: 'stale', ageSeconds: 86_400 })?.title).toBe(
      'Monitoring has not run in 1 day',
    )
  })

  it('rolls up to hours and days rather than showing large minute counts', () => {
    expect(sweepBannerCopy({ state: 'stale', ageSeconds: 7200 })?.title).toBe(
      'Monitoring has not run in 2 hours',
    )
    expect(sweepBannerCopy({ state: 'stale', ageSeconds: 3 * 86_400 })?.title).toBe(
      'Monitoring has not run in 3 days',
    )
  })

  it('points a stale banner at the two things that have actually broken before', () => {
    const copy = sweepBannerCopy({ state: 'stale', ageSeconds: 3000 })
    expect(copy?.subtitle).toContain('scheduler')
    expect(copy?.subtitle).toContain('CRON_SECRET')
  })

  it('carries no hyphens in user facing copy', () => {
    for (const state of [
      { state: 'never' } as const,
      { state: 'stale', ageSeconds: 3000 } as const,
    ]) {
      const copy = sweepBannerCopy(state)
      expect(`${copy?.title} ${copy?.subtitle}`).not.toMatch(/\w-\w/)
    }
  })
})

describe('buildHeartbeatPayload', () => {
  it('emits exactly three keys and never a field of the row', () => {
    const payload = buildHeartbeatPayload({ state: 'fresh', ageSeconds: 42 })
    expect(Object.keys(payload).sort()).toEqual(['ageSeconds', 'stale', 'thresholdSeconds'])
  })

  it('reports a fresh sweep as not stale, with its age', () => {
    expect(buildHeartbeatPayload({ state: 'fresh', ageSeconds: 42 })).toEqual({
      stale: false,
      ageSeconds: 42,
      thresholdSeconds: SWEEP_STALE_AFTER_SECONDS,
    })
  })

  it('reports a null age for a sweep that has never run, and calls it stale', () => {
    expect(buildHeartbeatPayload({ state: 'never' })).toEqual({
      stale: true,
      ageSeconds: null,
      thresholdSeconds: SWEEP_STALE_AFTER_SECONDS,
    })
  })
})
