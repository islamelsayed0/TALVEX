import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * BRD D5 as a test: every text/background token pair in the design system
 * meets WCAG 2.1 AA (4.5:1 for normal text), in both themes, forever.
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
const lightOverrides = tokensOf('[data-theme="light"]')
// Light inherits every dark token it does not override, like the cascade.
const lightTokens = new Map([...darkTokens, ...lightOverrides])

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
]

describe.each([
  ['dark', darkTokens],
  ['light', lightTokens],
] as const)('%s theme', (_theme, tokens) => {
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
  it('globals.css declares no green, amber, or red tokens', () => {
    // Every hex token in the file must be neutral (warm gray scale) or the
    // accent blue family: blue channel dominant, or near equal channels.
    // Green, amber, and red are reserved for status meaning (Phase 1+).
    for (const m of css.matchAll(/#([0-9a-f]{6})\b/gi)) {
      const n = parseInt(m[1], 16)
      const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
      const spread = Math.max(r, g, b) - Math.min(r, g, b)
      const isNeutral = spread <= 24
      const isBlue = b > r && b > g
      expect(
        isNeutral || isBlue,
        `#${m[1]} is neither neutral nor accent blue`,
      ).toBe(true)
    }
  })
})
