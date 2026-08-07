import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import * as copy from '@/app/pricing/copy'
import { isProtectedPath } from '@/lib/auth/routes'

/**
 * The pricing page's house rules (F13 PR 4), held the way
 * landing-copy.test.ts holds the landing's:
 *  - the frozen numbers (docs/DECISIONS.md 2026-08-07), pinned so a price
 *    change is a DECISIONS event, never a copy edit
 *  - the standing promises stated as substance, not labels
 *  - no hyphens in prose, the word MSP nowhere, no fabricated proof
 *  - THE TRUTH GATE: the route is public but UNLINKED from the landing page
 *    until billing goes live behind the recorded human gates
 */

function proseStrings(): string[] {
  const out: string[] = []
  const walk = (value: unknown, key?: string): void => {
    if (key === 'href') return // routes and mailtos, not prose
    if (typeof value === 'string') out.push(value)
    else if (Array.isArray(value)) value.forEach((v) => walk(v))
    else if (value && typeof value === 'object')
      Object.entries(value).forEach(([k, v]) => walk(v, k))
  }
  Object.values(copy).forEach((v) => walk(v))
  return out
}

const tierByName = (name: string) =>
  copy.PRICING_TIERS.find((t) => t.name === name)!

describe('the frozen pricing, number for number', () => {
  it('prices the five tiers and the add on exactly as decided', () => {
    expect(tierByName('Free').price).toBe('$0')
    expect(tierByName('Basic').price).toBe('$39')
    expect(tierByName('Pro').price).toBe('$79')
    expect(tierByName('Business').price).toBe('$199')
    expect(tierByName('Custom').price).toBeNull()
    expect(copy.AI_ADDON.price).toBe('$15')
    expect(copy.PRICING_TIERS).toHaveLength(5)
  })

  it('states the load bearing limits in the tier lines', () => {
    expect(tierByName('Free').includes.join(' ')).toContain('2 monitors')
    expect(tierByName('Basic').includes.join(' ')).toContain('15 monitors')
    expect(tierByName('Pro').includes.join(' ')).toContain('Unlimited monitors')
    expect(tierByName('Business').includes.join(' ')).toContain('Up to 10 organizations')
    expect(tierByName('Basic').blurb).toContain('around 20 staff')
  })
})

describe('the standing promises, as substance', () => {
  const promises = () => copy.PRICING_PROMISES.map((p) => `${p.title} ${p.body}`).join(' ')

  it('says alerts are included on every tier, always', () => {
    expect(promises()).toMatch(/Incident alerts are included on every tier, always/)
  })

  it('says seats are never counted, and no copy prices per person', () => {
    expect(promises()).toMatch(/Invite your whole team on any plan/)
    for (const s of proseStrings()) {
      expect(s, `per seat pricing implied in: "${s}"`).not.toMatch(/per (seat|user)/i)
    }
  })

  it('names all three cap anti patterns', () => {
    expect(promises()).toMatch(
      /No silent failures, no automatic upgrades, no overage charges/,
    )
  })

  it('keeps BYOK free and uncapped everywhere', () => {
    expect(promises()).toMatch(/uncapped and unmetered/)
  })
})

describe('house rules', () => {
  it('contains no hyphens in prose', () => {
    for (const s of proseStrings()) {
      expect(s, `hyphen in: "${s}"`).not.toMatch(/-/)
    }
  })

  it('never says MSP', () => {
    for (const s of proseStrings()) {
      expect(s, `MSP in: "${s}"`).not.toMatch(/\bMSP\b/i)
    }
  })

  it('fabricates no proof: no testimonials, logos, or customer counts', () => {
    const banned = [/trusted by/i, /testimonial/i, /\d[\d,]* (customers|companies|teams|organizations use)/i]
    for (const s of proseStrings()) {
      for (const rule of banned) {
        expect(s, `fabricated proof in: "${s}"`).not.toMatch(rule)
      }
    }
  })
})

describe('the truth gate', () => {
  it('/pricing is public by construction', () => {
    expect(isProtectedPath('/pricing')).toBe(false)
  })

  it('the landing page does not link to /pricing until billing goes live', () => {
    // The gate is the recorded human switch (docs/DECISIONS.md 2026-08-07:
    // clickwrap shipped, the TALVEXT statement descriptor set, an explicit go
    // ahead). When it is thrown, this assertion flips to demand the link.
    const landing = readFileSync(
      path.resolve(__dirname, '../src/app/page.tsx'),
      'utf8',
    )
    expect(landing).not.toContain('/pricing')
  })
})
