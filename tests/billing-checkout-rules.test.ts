import { describe, expect, it } from 'vitest'

import { TERMS, TERMS_EFFECTIVE } from '@/app/(legal)/_content/terms'
import {
  CheckoutValidationError,
  lookupKeysForSelection,
  parseCheckoutSelection,
} from '@/lib/billing/checkout-rules'

// The pure rules of the checkout form (F13 PR 2). The clickwrap refusal is
// the legally load bearing one: the server refuses regardless of what the
// browser claimed, so removing the checkbox client side buys nothing.

describe('parseCheckoutSelection', () => {
  it('refuses without terms acceptance, before anything else is considered', () => {
    for (const plan of ['basic', 'pro', 'business', 'nonsense']) {
      expect(() =>
        parseCheckoutSelection({ plan, aiAddon: false, termsAccepted: false }),
      ).toThrow(CheckoutValidationError)
      expect(() =>
        parseCheckoutSelection({ plan, aiAddon: false, termsAccepted: false }),
      ).toThrow(/agree to the Terms of Service and Privacy Policy/)
    }
  })

  it('accepts exactly the three purchasable plans', () => {
    for (const plan of ['basic', 'pro', 'business'] as const) {
      expect(
        parseCheckoutSelection({ plan, aiAddon: false, termsAccepted: true }),
      ).toEqual({ plan, aiAddon: false })
    }
  })

  it('rejects free, custom, and garbage plans', () => {
    for (const plan of ['free', 'custom', 'enterprise', '', 'BASIC']) {
      expect(() =>
        parseCheckoutSelection({ plan, aiAddon: false, termsAccepted: true }),
      ).toThrow(CheckoutValidationError)
    }
  })

  it('attaches the AI add on to Basic only', () => {
    expect(
      parseCheckoutSelection({ plan: 'basic', aiAddon: true, termsAccepted: true }),
    ).toEqual({ plan: 'basic', aiAddon: true })

    for (const plan of ['pro', 'business']) {
      expect(() =>
        parseCheckoutSelection({ plan, aiAddon: true, termsAccepted: true }),
      ).toThrow(/Basic only/)
    }
  })
})

describe('lookupKeysForSelection', () => {
  it('buys the plan price, and the add on when selected, plan first', () => {
    expect(lookupKeysForSelection({ plan: 'pro', aiAddon: false })).toEqual([
      'talvext_pro_monthly',
    ])
    expect(lookupKeysForSelection({ plan: 'basic', aiAddon: true })).toEqual([
      'talvext_basic_monthly',
      'talvext_ai_addon_monthly',
    ])
  })
})

describe('the clickwrap terms version', () => {
  it('is the effective date written inside the terms document itself', () => {
    // TERMS_EFFECTIVE is what gets stored on acceptance rows; the human
    // readable date inside the document is what the person accepted. The
    // two must never drift apart.
    const [year, month, day] = TERMS_EFFECTIVE.split('-').map(Number)
    const humanDate = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(new Date(Date.UTC(year, month - 1, day)))
    expect(TERMS.source).toContain(`**Effective date:** ${humanDate}`)
  })
})
