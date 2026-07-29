/**
 * Pure view logic for the public status page (BRD F9). No database, no React,
 * no environment: everything here is a deterministic transform of already
 * fetched data, so it is unit tested directly and reused by the page and the
 * settings validation. Slug rules mirror the check constraint in migration 011
 * exactly, so the form and the database agree.
 */

/** A monitor's stored status; null before its first check. */
export type PublicStatus = 'up' | 'down' | null

/** One daily uptime rollup, the two columns the heatmap needs. */
export type StatusRollup = { day: string; uptime_percent: number }

/**
 * Slug rules, identical to organizations_status_page_slug_format in migration
 * 011: lowercase letters and digits in segments joined by single hyphens, no
 * leading or trailing hyphen, 3 to 63 characters. Hyphens are allowed here
 * because a slug is a route path, exempt from the prose hyphen rule.
 */
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

export function isValidStatusSlug(slug: string): boolean {
  return slug.length >= 3 && slug.length <= 63 && SLUG_PATTERN.test(slug)
}

export type OverallState = {
  operational: boolean
  downCount: number
  total: number
  label: string
}

/**
 * The one line summary at the top of the page, derived from current monitor
 * status. A monitor with a null status (never checked) does not count as down.
 */
export function deriveOverallState(
  monitors: ReadonlyArray<{ last_status: PublicStatus }>,
): OverallState {
  const total = monitors.length
  const downCount = monitors.filter((m) => m.last_status === 'down').length
  const operational = downCount === 0
  const label =
    total === 0
      ? 'No monitors yet'
      : operational
        ? 'All systems operational'
        : `${downCount} ${downCount === 1 ? 'monitor' : 'monitors'} down`
  return { operational, downCount, total, label }
}

/** Uptime percent as a compact label: 100 becomes "100%", 99.5 stays "99.5%". */
export function formatUptime(percent: number): string {
  return `${parseFloat(percent.toFixed(2))}%`
}

/**
 * A monitor's uptime across its rollups, weighted by how many checks each day
 * held so a sparse day does not swing the number. Null when there is no data.
 */
export function aggregateUptime(
  rollups: ReadonlyArray<{ uptime_percent: number; check_count: number }>,
): number | null {
  if (rollups.length === 0) return null
  let weighted = 0
  let checks = 0
  for (const r of rollups) {
    weighted += r.uptime_percent * r.check_count
    checks += r.check_count
  }
  if (checks === 0) return null
  return weighted / checks
}

export type HeatmapTone = 'up' | 'partial' | 'down' | 'none'

/** One day's rollup to a heatmap color bucket. No rollup for a day is 'none'. */
export function heatmapTone(uptimePercent: number | null): HeatmapTone {
  if (uptimePercent === null) return 'none'
  if (uptimePercent >= 99.99) return 'up'
  if (uptimePercent >= 95) return 'partial'
  return 'down'
}

/**
 * The last `count` UTC day strings (YYYY-MM-DD) ending at and including
 * `referenceDay`, oldest first. Deterministic given the reference day.
 */
export function lastDays(referenceDay: string, count: number): string[] {
  const end = new Date(`${referenceDay}T00:00:00Z`)
  const days: string[] = []
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(end)
    d.setUTCDate(d.getUTCDate() - i)
    days.push(d.toISOString().slice(0, 10))
  }
  return days
}

export type HeatmapCell = { day: string; uptime: number | null; tone: HeatmapTone }

/** Builds the `count` day heatmap for one monitor from its rollups. */
export function buildHeatmap(
  rollups: ReadonlyArray<StatusRollup>,
  referenceDay: string,
  count = 90,
): HeatmapCell[] {
  const byDay = new Map(rollups.map((r) => [r.day, r.uptime_percent]))
  return lastDays(referenceDay, count).map((day) => {
    const uptime = byDay.get(day) ?? null
    return { day, uptime, tone: heatmapTone(uptime) }
  })
}
