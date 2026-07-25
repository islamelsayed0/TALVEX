import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * BRD D5 as a test: every text/background token pair in the design system
 * meets WCAG 2.1 AA (4.5:1 for normal text), in the dark theme (the product is
 * dark only), forever.
 *
 * The tokens are parsed straight out of globals.css, so a palette edit that
 * breaks contrast fails CI rather than shipping. Alpha colors are composited
 * over their background before measuring, which is how a browser paints
 * them. The focus ring is checked as a non text indicator (3:1, WCAG 1.4.11).
 *
 * Known and accepted: decorative borders (--border, --input, ghost borders)
 * sit below 3:1 by design; fields are identified by fill and placeholder,
 * and the focus state carries the 3:1 indicator. Documented in the Task 7 PR.
 */

const css = readFileSync(
  path.resolve(__dirname, '../src/app/globals.css'),
  'utf8',
)

/** Pull `--token: value;` pairs out of one top level selector block. */
function tokensOf(selector: string): Map<string, string> {
  const start = css.indexOf(selector)
  if (start === -1) throw new Error(`selector not found: ${selector}`)
  const open = css.indexOf('{', start)
  let depth = 1
  let end = open + 1
  while (depth > 0 && end < css.length) {
    if (css[end] === '{') depth++
    if (css[end] === '}') depth--
    end++
  }
  const block = css.slice(open + 1, end - 1)
  const map = new Map<string, string>()
  for (const m of block.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    map.set(m[1], m[2].replace(/\s+/g, ' ').trim())
  }
  return map
}

const darkTokens = tokensOf(':root')

type RGBA = { r: number; g: number; b: number; a: number }

function resolve(tokens: Map<string, string>, name: string): string {
  let value = tokens.get(name)
  if (value === undefined) throw new Error(`missing token --${name}`)
  // Follow var() aliases like --placeholder: var(--quiet).
  for (let hops = 0; hops < 5; hops++) {
    const m = value.match(/^var\(--([\w-]+)\)$/)
    if (!m) break
    const next = tokens.get(m[1])
    if (next === undefined) throw new Error(`missing token --${m[1]}`)
    value = next
  }
  return value
}

function parseColor(value: string): RGBA {
  const hex = value.match(/^#([0-9a-f]{6})$/i)
  if (hex) {
    const n = parseInt(hex[1], 16)
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 }
  }
  const rgba = value.match(
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/,
  )
  if (rgba) {
    return {
      r: Number(rgba[1]),
      g: Number(rgba[2]),
      b: Number(rgba[3]),
      a: rgba[4] === undefined ? 1 : Number(rgba[4]),
    }
  }
  throw new Error(`not a plain color: ${value}`)
}

/** Composite fg over an opaque bg (how the browser paints alpha colors). */
function over(fg: RGBA, bg: RGBA): RGBA {
  const a = fg.a
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  }
}

function luminance({ r, g, b }: RGBA): number {
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function contrast(fgName: string, bgName: string, tokens: Map<string, string>) {
  const bg = parseColor(resolve(tokens, bgName))
  if (bg.a !== 1) throw new Error(`background --${bgName} must be opaque`)
  const fg = over(parseColor(resolve(tokens, fgName)), bg)
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a)
  return (hi + 0.05) / (lo + 0.05)
}

/** [foreground token, background token] pairs that carry normal size text. */
const TEXT_PAIRS: Array<[string, string]> = [
  ['foreground', 'background'],
  ['muted-foreground', 'background'],
  ['quiet', 'background'],
  ['link', 'background'],
  ['ghost-text', 'background'],
  ['accent-text', 'background'],
  ['field-text', 'field-bg'],
  ['field-text', 'field-bg-focus'],
  ['placeholder', 'field-bg'],
  ['placeholder', 'field-bg-focus'],
  ['primary-foreground', 'primary'],
  ['primary-foreground', 'primary-hover'],
  ['card-foreground', 'card'],
  ['quiet', 'card'],
  ['muted-foreground', 'card'],
  // Dashboard text tokens (added with the design reskin). Secondary carries
  // dense body and activity rows; chip text carries recurrence and linked
  // incident labels, which sit on the card. Guarded in both themes.
  ['secondary-foreground', 'background'],
  ['secondary-foreground', 'card'],
  ['chip-text', 'card'],
  // Status colors (Phase 1) carry text and icons on the page and on cards.
  ['status-up', 'background'],
  ['status-up', 'card'],
  ['status-down', 'background'],
  ['status-down', 'card'],
  ['status-pending', 'background'],
  ['status-pending', 'card'],
]

describe.each([['dark', darkTokens]] as const)('%s theme', (_theme, tokens) => {
  it.each(TEXT_PAIRS)('--%s on --%s meets AA for normal text', (fg, bg) => {
    expect(contrast(fg, bg, tokens)).toBeGreaterThanOrEqual(4.5)
  })

  it('focus ring is a visible indicator on fields (3:1)', () => {
    expect(contrast('ring', 'field-bg', tokens)).toBeGreaterThanOrEqual(3)
  })

  it('accent text stays AA on the accent tinted hover background', () => {
    // The create organization button tints its background on hover; the
    // label must stay readable in that state too.
    const page = parseColor(resolve(tokens, 'background'))
    const hoverBg = over(parseColor(resolve(tokens, 'accent-hover-bg')), page)
    const text = over(parseColor(resolve(tokens, 'accent-text')), hoverBg)
    const [hi, lo] = [luminance(text), luminance(hoverBg)].sort((a, b) => b - a)
    expect((hi + 0.05) / (lo + 0.05)).toBeGreaterThanOrEqual(4.5)
  })

  it('background tokens stay opaque', () => {
    for (const name of ['background', 'card', 'field-bg', 'primary']) {
      expect(parseColor(resolve(tokens, name)).a).toBe(1)
    }
  })
})

describe('reserved colors', () => {
  // Green, amber, and red are reserved for status meaning. TWO families of
  // tokens may legitimately carry them, and both are sanctioned here BY NAME,
  // on purpose, not by slipping past the scan:
  //   --status-*  the base status colors (green up, red down, amber pending)
  //   --wash-*    the translucent fills behind status icons and chips, derived
  //               from the status colors, so necessarily green and red too
  // Every OTHER color literal in globals.css must be neutral (warm gray) or the
  // accent blue. The scan reads rgba as well as hex, so a colored value cannot
  // hide behind the alpha syntax: that would make rgba the known way past the
  // guard. Widening the scan and naming the exceptions keeps it honest.

  const COLOR_RE = /#[0-9a-f]{6}\b|rgba?\([^)]*\)/gi

  /** Channels of a hex or rgb/rgba literal, or null if it is not a color. */
  function channelsOf(literal: string): { r: number; g: number; b: number } | null {
    const hex = literal.match(/^#([0-9a-f]{6})$/i)
    if (hex) {
      const n = parseInt(hex[1], 16)
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
    }
    const rgb = literal.match(
      /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*[\d.]+\s*)?\)$/i,
    )
    if (rgb) return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) }
    return null
  }
  const key = (c: { r: number; g: number; b: number }) => `${c.r}-${c.g}-${c.b}`

  // The sanctioned exceptions, collected from the --status-* and --wash-*
  // declarations themselves, so the exemption is tied to those names.
  const sanctioned = new Set<string>()
  for (const m of css.matchAll(/--(?:status|wash)-[\w-]+:\s*([^;]+);/gi)) {
    const lit = m[1].match(COLOR_RE)?.[0]
    const ch = lit ? channelsOf(lit) : null
    if (ch) sanctioned.add(key(ch))
  }

  it('outside the status and wash tokens, no green, amber, or red appears', () => {
    for (const m of css.matchAll(COLOR_RE)) {
      const ch = channelsOf(m[0])
      if (!ch) continue
      if (sanctioned.has(key(ch))) continue
      const spread = Math.max(ch.r, ch.g, ch.b) - Math.min(ch.r, ch.g, ch.b)
      const isNeutral = spread <= 24
      const isBlue = ch.b > ch.r && ch.b > ch.g
      expect(
        isNeutral || isBlue,
        `${m[0]} is neither neutral nor accent blue`,
      ).toBe(true)
    }
  })

  it.each([['dark', darkTokens]] as const)(
    'status tokens carry their meaning in the %s theme',
    (_t, tokens) => {
    // Up is green, down is red, pending is amber, in both themes; a swapped
    // or off family value would lie to the user about status.
    const channels = (name: string) => {
      const { r, g, b } = parseColor(resolve(tokens, name))
      return { r, g, b }
    }
    const up = channels('status-up')
    expect(up.g, 'status-up must be green dominant').toBeGreaterThan(up.r)
    expect(up.g).toBeGreaterThan(up.b)
    const down = channels('status-down')
    expect(down.r, 'status-down must be red dominant').toBeGreaterThan(down.g)
    expect(down.r).toBeGreaterThan(down.b)
    const pending = channels('status-pending')
    expect(pending.r, 'status-pending must be amber').toBeGreaterThan(pending.b)
    expect(pending.g, 'status-pending must be amber').toBeGreaterThan(pending.b)
  })
})
