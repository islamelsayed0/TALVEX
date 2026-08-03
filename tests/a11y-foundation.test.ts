import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The accessibility foundation, held as a test.
 *
 * /accessibility commits Talvex to WCAG 2.2 AA. tests/e2e/accessibility.spec.mjs
 * proves the pages it scans, but it needs a running app and a session, so it is
 * not what CI runs on every push. These are the structural promises that can be
 * checked from the source alone, and they are the ones that rot quietly:
 * nothing about a page looks wrong when the skip link stops being first, or
 * when a new field class brings outline-none back with it.
 */

const ROOT = path.resolve(__dirname, '..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (entry.endsWith('.tsx')) out.push(full)
  }
  return out
}

/**
 * Source with comments removed.
 *
 * These checks scan for markup, and this file is full of prose *about* that
 * markup. Without stripping, the sentence "every page's <main> carries it" in
 * a doc comment reads as a <main> element with no id, and the suite fails on
 * its own documentation. Learned the hard way.
 */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const TSX = walk(path.join(ROOT, 'src'))
const codeOf = (file: string) => code(readFileSync(file, 'utf8'))
const css = read('src/app/globals.css')

describe('focus ring', () => {
  it('is declared once, as tokens', () => {
    expect(css).toMatch(/--focus-ring:\s*#[0-9a-fA-F]{6};/)
    expect(css).toMatch(/--focus-ring-width:\s*\d+px;/)
    expect(css).toMatch(/--focus-ring-offset:\s*\d+px;/)
  })

  it('is at least 2px', () => {
    const width = /--focus-ring-width:\s*(\d+)px;/.exec(css)?.[1]
    expect(Number(width)).toBeGreaterThanOrEqual(2)
  })

  it('is applied globally through :focus-visible', () => {
    // Not :focus. A mouse click should not leave a ring behind; a Tab should.
    expect(css).toMatch(/^\s*:focus-visible\s*\{/m)
    const block = css.slice(css.search(/^\s*:focus-visible\s*\{/m))
    expect(block.slice(0, 200)).toContain('var(--focus-ring)')
  })

  it('is never removed by a utility', () => {
    /*
     * The load bearing one.
     *
     * The layer order in globals.css puts utilities after base, so a Tailwind
     * outline-none on an element beats the :focus-visible rule no matter how
     * that rule is written. The CSS cannot defend itself here; this is the only
     * thing that can. Six field classes carried outline-none before this
     * branch, which is why most of the app had no visible focus at all.
     */
    const offenders = TSX.filter((f) => codeOf(f).includes('outline-none'))
      .map((f) => path.relative(ROOT, f))
    expect(offenders, 'outline-none removes the focus ring').toEqual([])
  })
})

describe('skip link', () => {
  const layout = read('src/app/layout.tsx')

  it('is rendered in the root layout, so every route has one', () => {
    expect(layout).toContain('<SkipLink />')
  })

  it('is the first thing in the body', () => {
    // If anything focusable precedes it, it is not a skip link any more.
    const body = layout.slice(layout.indexOf('<body'))
    const skip = body.indexOf('<SkipLink />')
    const children = body.indexOf('{children}')
    expect(skip).toBeGreaterThan(-1)
    expect(skip).toBeLessThan(children)
  })

  it('points at the target every page provides', () => {
    expect(code(read('src/components/skip-link.tsx'))).toContain('href="#main-content"')
  })

  it('stays in the focus order while hidden', () => {
    // display:none and visibility:hidden both remove an element from the tab
    // order, which would make this link unreachable by the one input method it
    // exists for. sr-only clips instead.
    const src = code(read('src/components/skip-link.tsx'))
    expect(src).toContain('sr-only')
    expect(src).toContain('focus-visible:not-sr-only')
    expect(src).not.toMatch(/\bhidden\b/)
  })
})

describe('main landmarks', () => {
  const withMain = TSX.filter((f) => codeOf(f).includes('<main'))

  it('exist on the pages that render one', () => {
    expect(withMain.length).toBeGreaterThan(30)
  })

  it('every one carries the skip link target', () => {
    const missing = withMain
      .filter((f) => {
        const src = codeOf(f)
        return src.split('<main').length - 1 !== src.split('id="main-content"').length - 1
      })
      .map((f) => path.relative(ROOT, f))
    expect(missing, 'a <main> with no id="main-content" is unreachable by the skip link').toEqual([])
  })

  it('covers the landing page, which had no main at all', () => {
    expect(code(read('src/app/page.tsx'))).toContain('<main id="main-content">')
  })
})

describe('reduced motion', () => {
  it('is respected globally and by the scroll driven animations', () => {
    // Scroll driven animations ignore a zeroed duration, so they need their own
    // switch; that is why there are two blocks rather than one.
    const blocks = css.match(/@media \(prefers-reduced-motion: reduce\)/g) ?? []
    expect(blocks.length).toBeGreaterThanOrEqual(2)
  })
})

describe('lint enforcement', () => {
  const config = read('eslint.config.mjs')

  it('runs the jsx-a11y recommended set in the CI lint job', () => {
    expect(config).toContain('jsx-a11y')
    expect(config).toContain('jsxA11y.flatConfigs.recommended.rules')
  })

  it('documents the one rule that is configured rather than taken as shipped', () => {
    // The default is zero exceptions. This one exists because axe and jsx-a11y
    // require opposite things of a scrollable region, and axe is right.
    const idx = config.indexOf('jsx-a11y/no-noninteractive-tabindex')
    expect(idx).toBeGreaterThan(-1)
    const reason = config.slice(Math.max(0, idx - 1200), idx)
    expect(reason).toContain('scrollable-region-focusable')
    expect(reason).toContain('WCAG 2.1.1')
  })
})
