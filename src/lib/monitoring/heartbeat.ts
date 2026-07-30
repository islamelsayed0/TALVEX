/**
 * Is the sweep alive, and how do we say so.
 *
 * Pure, no database and no clock of its own: every function takes the instant
 * it should reason about, so the whole decision table is testable and the
 * dashboard, the public endpoint, and the tests all answer the same way.
 *
 * The failure this exists for: the sweep stopped in production and every
 * screen kept rendering the last values it had, so the product reported
 * health from data that had stopped updating. Freshness is therefore not a
 * detail on a settings page. It gates whether the Overview verdict is allowed
 * to make a claim at all.
 */

/** The cadence the external scheduler is configured for. */
export const SWEEP_INTERVAL_SECONDS = 300

/**
 * How stale is stale. Three missed sweeps rather than one, so a single late
 * invocation (the scheduler is third party and best effort) does not flap the
 * banner on and off. Fifteen minutes is also short enough that a human sees it
 * within the same working session the outage began.
 */
export const SWEEP_STALE_AFTER_SECONDS = 900

export type SweepFreshness =
  | { state: 'never' }
  | { state: 'fresh' | 'stale'; ageSeconds: number }

/**
 * Freshness from the stored timestamp. `never` is deliberately its own state
 * rather than an infinitely stale one: a deployment that has not run the sweep
 * yet and a deployment whose sweep died need different wording, and treating
 * the first as an outage would cry wolf on every fresh environment.
 */
export function sweepFreshness(lastRunAtIso: string | null, nowMs: number): SweepFreshness {
  if (lastRunAtIso === null) return { state: 'never' }
  const lastMs = Date.parse(lastRunAtIso)
  if (Number.isNaN(lastMs)) return { state: 'never' }
  // Clamped at zero: a clock skew that puts the stamp slightly in the future
  // should read as brand new, never as a negative age.
  const ageSeconds = Math.max(0, Math.floor((nowMs - lastMs) / 1000))
  return {
    state: ageSeconds >= SWEEP_STALE_AFTER_SECONDS ? 'stale' : 'fresh',
    ageSeconds,
  }
}

/** True when the platform should stop making claims about system health. */
export function sweepIsStale(freshness: SweepFreshness): boolean {
  return freshness.state !== 'fresh'
}

/** "47 minutes", "2 hours", "3 days". Whole units, never a decimal. */
function humanAge(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'}`
  const days = Math.floor(hours / 24)
  return `${days} ${days === 1 ? 'day' : 'days'}`
}

export type SweepBannerCopy = { title: string; subtitle: string }

/**
 * The one wording for a stale sweep. Every surface reads it from here so the
 * banner and any later screen cannot drift apart. Returns null when the sweep
 * is fresh, which is the caller's signal to render nothing.
 *
 * The subtitle names the two things that have actually gone wrong before (the
 * scheduler disabled itself, and the shared secret drifted), because a banner
 * that only says something is wrong sends the reader hunting.
 */
export function sweepBannerCopy(freshness: SweepFreshness): SweepBannerCopy | null {
  if (freshness.state === 'fresh') return null
  if (freshness.state === 'never') {
    return {
      title: 'Monitoring has not reported yet',
      subtitle:
        'No sweep has run on this deployment. Checks, alerts, and the numbers on this page are not live yet.',
    }
  }
  return {
    title: `Monitoring has not run in ${humanAge(freshness.ageSeconds)}`,
    subtitle:
      'Checks, alerts, and the numbers on this page are stale. Confirm the scheduler is enabled and that CRON_SECRET matches the deployment.',
  }
}

/**
 * The entire public payload of the freshness endpoint, shaped here rather than
 * in the route so it is unit testable and cannot grow a field by accident.
 * Three keys, no counts, no tenant, nothing that names the platform's internals.
 */
export type HeartbeatPayload = {
  stale: boolean
  ageSeconds: number | null
  thresholdSeconds: number
}

export function buildHeartbeatPayload(freshness: SweepFreshness): HeartbeatPayload {
  return {
    stale: sweepIsStale(freshness),
    ageSeconds: freshness.state === 'never' ? null : freshness.ageSeconds,
    thresholdSeconds: SWEEP_STALE_AFTER_SECONDS,
  }
}
