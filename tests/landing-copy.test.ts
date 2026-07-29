import { describe, expect, it } from 'vitest'

import * as copy from '@/app/_landing/copy'

/**
 * The landing page's house rules, held as a test the same way
 * design-tokens.test.ts holds the palette:
 *  - no hyphens in prose (CLAUDE.md; en dashes or rewrites only)
 *  - the user facing word is "documents", never "articles" (2026-07-29 ruling)
 *  - no claims the code cannot back: nothing automatic about tickets,
 *    no SMS, no quiet hours (BRD F10 as shipped: email + Discord)
 */

/** Collect every prose string reachable from the copy module. */
function proseStrings(): string[] {
  const out: string[] = []
  const walk = (value: unknown): void => {
    if (typeof value === 'string') out.push(value)
    else if (Array.isArray(value)) value.forEach(walk)
    else if (value && typeof value === 'object')
      Object.values(value).forEach(walk)
  }
  for (const [name, value] of Object.entries(copy)) {
    if (name === 'REPO_URL') continue // a URL, not prose
    walk(value)
  }
  return out
}

describe('landing copy', () => {
  it('contains no hyphens in prose', () => {
    for (const s of proseStrings()) {
      expect(s, `hyphen in: "${s}"`).not.toMatch(/-/)
    }
  })

  it('says documents, never articles', () => {
    for (const s of proseStrings()) {
      expect(s.toLowerCase(), `"article" in: "${s}"`).not.toContain('article')
    }
  })

  it('never promises what does not ship', () => {
    const banned = [
      /\bsms\b/i,
      /text message/i,
      /quiet hours/i,
      /automatically (opens|creates) a ticket/i,
      /hipaa/i,
      /complian(t|ce)/i,
      /every (minute|60 seconds)/i,
    ]
    for (const s of proseStrings()) {
      for (const rule of banned) {
        expect(s, `banned claim in: "${s}"`).not.toMatch(rule)
      }
    }
  })

  it('points the repository link at the real repository', () => {
    expect(copy.REPO_URL).toBe('https://github.com/islamelsayed0/TALVEX')
  })
})
