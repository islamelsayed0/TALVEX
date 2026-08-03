/**
 * The status dot, with a shape that carries the state on its own.
 *
 * The accessibility statement at /accessibility says status is "always
 * conveyed by text and icons, never by color alone". Every indicator in the
 * app used to be the same circle in a different color, which meant the shape
 * carried nothing and a reader who cannot separate green from red was left
 * with whatever text happened to sit beside it. On the public status page
 * there was no such text, so the state was unreadable.
 *
 * So each state gets its own silhouette, legible at 8px:
 *
 *   up       filled circle
 *   down     filled diamond (a square turned 45 degrees)
 *   pending  hollow ring
 *   active   filled square, for work in progress
 *   paused   short bar, neutral, because paused is not a status
 *
 * The mark is always aria-hidden. It is a second, redundant channel for
 * sighted readers; the text label beside it is what assistive technology
 * reads, which is why every caller must render one. StatusText exists to make
 * that pairing the easy thing to do.
 */

export type StatusTone = 'up' | 'down' | 'pending' | 'active' | 'paused'

const TONE_BG: Record<StatusTone, string> = {
  up: 'bg-status-up',
  down: 'bg-status-down',
  // The ring is drawn in border-current, so it takes its color from the text
  // class and needs no fill of its own.
  pending: '',
  // In progress is not a status; it is the accent, and stays outside the
  // reserved green/amber/red palette.
  active: 'bg-(--accent-text)',
  paused: 'bg-quiet',
}

const TONE_TEXT: Record<StatusTone, string> = {
  up: 'text-status-up',
  down: 'text-status-down',
  pending: 'text-status-pending',
  active: 'text-accent-text',
  paused: 'text-quiet',
}

export const STATUS_TONES: readonly StatusTone[] = [
  'up',
  'down',
  'pending',
  'active',
  'paused',
] as const

export function statusTextClass(tone: StatusTone): string {
  return TONE_TEXT[tone]
}

/** The silhouette for a tone, color excluded. */
export function statusShapeClass(tone: StatusTone): string {
  return tone === 'down'
    ? 'rotate-45 rounded-[1px]'
    : tone === 'pending'
      ? 'rounded-full border-[1.5px] border-current'
      : tone === 'active' || tone === 'paused'
        ? 'rounded-[1px]'
        : 'rounded-full'
}

/** Box for a tone. A diamond reads smaller than a circle in the same box, and
 * a bar is a deliberate sliver, so both are sized against the circle. This is
 * what separates active (square) from paused (bar): same corner radius,
 * different proportions. */
export function statusBox(
  tone: StatusTone,
  size: number,
): { width: number; height: number } {
  if (tone === 'down') return { width: size * 0.82, height: size * 0.82 }
  if (tone === 'paused') {
    return { width: size, height: Math.max(2, Math.round(size * 0.34)) }
  }
  return { width: size, height: size }
}

/**
 * Everything about a mark except its color: the shape and the proportions.
 *
 * Exported so tests can assert the thing that actually matters, which is that
 * these are all different from each other. A future edit that quietly gives
 * two states the same silhouette puts the app back to separating those two by
 * color alone, and nothing about the rendered page would look wrong.
 */
export function statusSignature(tone: StatusTone): string {
  const { width, height } = statusBox(tone, 100)
  return `${statusShapeClass(tone)} ${width}x${height}`
}

export function StatusMark({
  tone,
  size = 9,
}: {
  tone: StatusTone
  size?: number
}) {
  // Shape first, color second. If the color were stripped entirely, these five
  // would still be five different marks.
  return (
    <span
      aria-hidden
      style={statusBox(tone, size)}
      className={`inline-block flex-none ${statusShapeClass(tone)} ${TONE_BG[tone]} ${TONE_TEXT[tone]}`}
    />
  )
}

/**
 * A mark and its label together. This is the shape callers should reach for,
 * because it cannot be built wrong: the text is not optional.
 */
export function StatusText({
  tone,
  label,
  size = 9,
  className = 'text-sm font-medium',
}: {
  tone: StatusTone
  label: string
  size?: number
  className?: string
}) {
  return (
    <span
      className={`inline-flex items-center gap-2 ${TONE_TEXT[tone]} ${className}`}
    >
      <StatusMark tone={tone} size={size} />
      {label}
    </span>
  )
}
