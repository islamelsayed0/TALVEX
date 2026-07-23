import type { MonitorCheck } from '@/lib/db/types'

/**
 * Response time over recent checks, as a small server rendered SVG. No
 * chart library: one polyline and a few dots cover Phase 1. Colors come
 * from the design tokens via CSS variables (SVG resolves them like any
 * other element), so both themes work and the status palette keeps its
 * meaning: green dots answered, red dots failed.
 *
 * Checks are spaced evenly by order, not by wall clock: on the daily Hobby
 * cron the real gaps are enormous and a time proportional x axis would
 * squash every point into a corner. The end labels carry the actual dates.
 */

const WIDTH = 560
const HEIGHT = 140
const PAD_X = 8
const PAD_TOP = 12
const PAD_BOTTOM = 22

export function ResponseChart({ checks }: { checks: MonitorCheck[] }) {
  // Oldest first for left to right reading.
  const series = [...checks].reverse()
  const measured = series.filter((c) => c.response_time_ms !== null)
  if (measured.length === 0) return null

  const maxMs = Math.max(...measured.map((c) => c.response_time_ms!), 1)
  const floorY = HEIGHT - PAD_BOTTOM
  const x = (index: number) =>
    series.length === 1
      ? WIDTH / 2
      : PAD_X + (index * (WIDTH - 2 * PAD_X)) / (series.length - 1)
  const y = (ms: number) =>
    floorY - (ms / maxMs) * (floorY - PAD_TOP)

  const linePoints = series
    .map((c, i) =>
      c.response_time_ms !== null ? `${x(i)},${y(c.response_time_ms)}` : null,
    )
    .filter(Boolean)
    .join(' ')

  const first = series[0]
  const last = series[series.length - 1]
  const day = (iso: string) => {
    const d = new Date(iso)
    const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
    return `${month} ${d.getUTCDate()}`
  }

  return (
    <figure className="rounded-button border border-border bg-card p-4">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="block w-full"
        role="img"
        aria-label={`Response time across the last ${series.length} checks, up to ${maxMs} milliseconds`}
      >
        {/* Baseline and the max response gridline. */}
        <line x1={PAD_X} y1={floorY} x2={WIDTH - PAD_X} y2={floorY} stroke="var(--border)" />
        <line
          x1={PAD_X}
          y1={PAD_TOP}
          x2={WIDTH - PAD_X}
          y2={PAD_TOP}
          stroke="var(--border)"
          strokeDasharray="3 5"
        />
        <text x={WIDTH - PAD_X} y={PAD_TOP - 3} textAnchor="end" fontSize="10" fill="var(--quiet)">
          {maxMs} ms
        </text>

        {measured.length > 1 ? (
          <polyline
            points={linePoints}
            fill="none"
            stroke="var(--accent-text)"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        ) : null}

        {series.map((check, i) =>
          check.response_time_ms !== null ? (
            <circle
              key={check.id}
              cx={x(i)}
              cy={y(check.response_time_ms)}
              r="3"
              fill={check.status === 'up' ? 'var(--status-up)' : 'var(--status-down)'}
            />
          ) : (
            // A check with no response at all (timeout, refused): a red
            // mark on the baseline, since there is no time to plot.
            <rect
              key={check.id}
              x={x(i) - 2.5}
              y={floorY - 2.5}
              width="5"
              height="5"
              transform={`rotate(45 ${x(i)} ${floorY})`}
              fill="var(--status-down)"
            />
          ),
        )}

        <text x={PAD_X} y={HEIGHT - 6} fontSize="10" fill="var(--quiet)">
          {day(first.checked_at)}
        </text>
        <text x={WIDTH - PAD_X} y={HEIGHT - 6} textAnchor="end" fontSize="10" fill="var(--quiet)">
          {day(last.checked_at)}
        </text>
      </svg>
      <figcaption className="mt-2 text-xs text-quiet">
        Response time across the last {series.length}{' '}
        {series.length === 1 ? 'check' : 'checks'}. Red diamonds are checks
        that got no response.
      </figcaption>
    </figure>
  )
}
