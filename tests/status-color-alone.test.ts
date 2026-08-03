import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  STATUS_TONES,
  statusShapeClass,
  statusSignature,
  statusTextClass,
  type StatusTone,
} from '@/components/status-mark'

/**
 * The color alone prohibition, held as a test.
 *
 * /accessibility says status is "always conveyed by text and icons, never by
 * color alone". That was a present tense claim the app did not meet: every
 * indicator was the same circle in a different color, and on the public status
 * page there was no text beside it at all.
 *
 * Two things have to stay true for the sentence to keep being true, and both
 * are the kind that rot silently because the page still looks fine when they
 * break:
 *
 * 1. The five tones keep five different silhouettes. Collapsing two to the
 *    same shape restores the color alone failure for that pair.
 * 2. The status page keeps a text label on every monitor row.
 *
 * This suite holds the first directly and the second by reading the source,
 * because the page is an async server component hitting the database and the
 * repo has no React renderer. The rendered proof is in
 * tests/e2e/status-page.spec.mjs, against a real URL.
 */

const src = (rel: string) =>
  readFileSync(path.resolve(__dirname, '..', rel), 'utf8')

describe('status marks', () => {
  it('gives every tone a silhouette no other tone shares', () => {
    const seen = new Map<string, StatusTone>()
    for (const tone of STATUS_TONES) {
      const sig = statusSignature(tone)
      const clash = seen.get(sig)
      expect(
        clash,
        `"${tone}" and "${clash}" render the same mark, so only color tells them apart`,
      ).toBeUndefined()
      seen.set(sig, tone)
    }
    expect(seen.size).toBe(STATUS_TONES.length)
  })

  it('separates up from down by shape, not only by red and green', () => {
    // The pair that matters most, and the pair a red/green color blind reader
    // cannot separate by hue at all.
    expect(statusShapeClass('up')).not.toBe(statusShapeClass('down'))
  })

  it('keeps the neutral tones out of the reserved status palette', () => {
    // Green, amber, and red carry status meaning and nothing else
    // (tests/design-tokens.test.ts). Paused is not a status and in progress is
    // the accent, so neither may reach for a --status-* token.
    expect(statusTextClass('paused')).not.toMatch(/status-/)
    expect(statusTextClass('active')).not.toMatch(/status-/)
    expect(statusTextClass('up')).toMatch(/status-/)
    expect(statusTextClass('down')).toMatch(/status-/)
    expect(statusTextClass('pending')).toMatch(/status-/)
  })
})

describe('public status page', () => {
  const page = src('src/app/status/[slug]/page.tsx')

  it('names every monitor state in words', () => {
    // The fix for the false claim: a bare mark beside the monitor name was the
    // only carrier of up versus down.
    expect(page).toContain('MONITOR_STATE_LABEL')
    for (const label of ['Operational', 'Down', 'No data yet']) {
      expect(page, `missing state label: ${label}`).toContain(`'${label}'`)
    }
  })

  it('says an incident is over rather than only coloring it green', () => {
    expect(page).toContain('Resolved in ')
  })

  it('renders no bare color dot', () => {
    // A rounded-full span whose only distinguishing class is a bg-status-*
    // token is exactly the thing this branch removed.
    expect(page).not.toMatch(/rounded-full[^`'"]*bg-status-/)
    expect(page).not.toMatch(/bg-status-[a-z]+[^`'"]*rounded-full/)
  })
})

describe('status page heatmap', () => {
  const css = src('src/app/globals.css')

  it('gives each tone a fill pattern, not only a fill color', () => {
    // Ninety days of history is unreadable to a color blind visitor if the
    // three states differ only in hue.
    expect(css).toContain('.heat-partial')
    expect(css).toContain('.heat-down')
    const partial = css.slice(css.indexOf('.heat-partial'))
    const down = css.slice(css.indexOf('.heat-down'))
    expect(partial.slice(0, 260)).toContain('repeating-linear-gradient')
    expect(down.slice(0, 260)).toContain('repeating-linear-gradient')
  })

  it('angles the two downtime patterns differently', () => {
    // Same stripe angle in two colors would put us back where we started.
    const partial = css.slice(css.indexOf('.heat-partial'), css.indexOf('.heat-down'))
    const down = css.slice(css.indexOf('.heat-down'), css.indexOf('.heat-none'))
    const angle = (block: string) => /(-?\d+)deg/.exec(block)?.[1]
    expect(angle(partial)).toBeDefined()
    expect(angle(down)).toBeDefined()
    expect(angle(partial)).not.toBe(angle(down))
  })

  it('labels the fills so neither channel has to be guessed', () => {
    const page = src('src/app/status/[slug]/page.tsx')
    expect(page).toContain('HeatmapKey')
    for (const label of ['no downtime', 'partial downtime', 'no data']) {
      expect(page, `missing heatmap label: ${label}`).toContain(label)
    }
  })
})
