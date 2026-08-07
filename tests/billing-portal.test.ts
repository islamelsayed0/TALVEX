import { describe, expect, it } from 'vitest'

import {
  AI_ADDON_PRICE_LOOKUP_KEY,
  aiAddonChange,
  formatUsd,
  lookupKeysForSelection,
  PLAN_PRICE_LOOKUP_KEYS,
} from '@/lib/billing/checkout-rules'
import {
  PORTAL_HEADLINE,
  portalConfigurationParams,
  portalProductsMatch,
} from '@/lib/billing/portal-config'
import { AI_ADDON_LOOKUP_KEY, PLAN_LOOKUP_KEYS } from '@/lib/db/stripe-sync'

// Subscription management (F13 follow up): the portal configuration built in
// code, and the in app add on toggle's decision logic. What matters here is
// the same thing the checkout tests protect: the shape of what customers can
// do to their own subscription is a recorded product decision, not an
// accident of dashboard clicks.

describe('the duplicated lookup keys stay pinned together', () => {
  // checkout-rules duplicates the keys so scripts can import them without
  // the server only marker on stripe-sync. This is the pin.
  it('add on key matches stripe-sync', () => {
    expect(AI_ADDON_PRICE_LOOKUP_KEY).toBe(AI_ADDON_LOOKUP_KEY)
  })

  it('plan keys match stripe-sync exactly', () => {
    expect([...PLAN_PRICE_LOOKUP_KEYS].sort()).toEqual(
      Object.keys(PLAN_LOOKUP_KEYS).sort(),
    )
  })

  it('plan keys match what checkout sells', () => {
    for (const plan of ['basic', 'pro', 'business'] as const) {
      const [key] = lookupKeysForSelection({ plan, aiAddon: false })
      expect(PLAN_PRICE_LOOKUP_KEYS).toContain(key)
    }
  })
})

describe('portalConfigurationParams', () => {
  const products = [
    { product: 'prod_basic', price: 'price_basic' },
    { product: 'prod_pro', price: 'price_pro' },
    { product: 'prod_business', price: 'price_business' },
  ]

  it('cancels at period end, never immediately', () => {
    const params = portalConfigurationParams(products)
    expect(params.features?.subscription_cancel).toEqual({
      enabled: true,
      mode: 'at_period_end',
    })
  })

  it('offers plan switching across exactly the given plans, prices only', () => {
    const update = portalConfigurationParams(products).features?.subscription_update
    expect(update?.enabled).toBe(true)
    expect(update?.default_allowed_updates).toEqual(['price'])
    expect(update?.products).toEqual([
      { product: 'prod_basic', prices: ['price_basic'] },
      { product: 'prod_pro', prices: ['price_pro'] },
      { product: 'prod_business', prices: ['price_business'] },
    ])
  })

  it('enables invoices and card updates, and links the real legal pages', () => {
    const params = portalConfigurationParams(products)
    expect(params.features?.invoice_history).toEqual({ enabled: true })
    expect(params.features?.payment_method_update).toEqual({ enabled: true })
    expect(params.business_profile?.headline).toBe(PORTAL_HEADLINE)
    expect(params.business_profile?.terms_of_service_url).toBe('https://talvext.com/terms')
    expect(params.business_profile?.privacy_policy_url).toBe('https://talvext.com/privacy')
  })
})

describe('formatUsd', () => {
  it('renders cents as on screen dollars, sign outside the mark', () => {
    expect(formatUsd(5400)).toBe('$54.00')
    expect(formatUsd(1500)).toBe('$15.00')
    expect(formatUsd(0)).toBe('$0.00')
    // A removal preview can be a net credit.
    expect(formatUsd(-1250)).toBe('-$12.50')
  })
})

describe('portalProductsMatch', () => {
  const desired = portalConfigurationParams([
    { product: 'prod_a', price: 'price_a' },
    { product: 'prod_b', price: 'price_b' },
  ])
  const live = (products: Array<{ product: string; prices: string[] }>) =>
    ({
      features: { subscription_update: { products } },
    }) as never

  it('matches regardless of product order', () => {
    expect(
      portalProductsMatch(
        live([
          { product: 'prod_b', prices: ['price_b'] },
          { product: 'prod_a', prices: ['price_a'] },
        ]),
        desired,
      ),
    ).toBe(true)
  })

  it('detects a replaced price, the drift the ensure repairs', () => {
    expect(
      portalProductsMatch(
        live([
          { product: 'prod_a', prices: ['price_a_old'] },
          { product: 'prod_b', prices: ['price_b'] },
        ]),
        desired,
      ),
    ).toBe(false)
    expect(portalProductsMatch(live([]), desired)).toBe(false)
  })
})

describe('aiAddonChange', () => {
  const planItem = { id: 'si_plan', lookupKey: 'talvext_basic_monthly' }
  const addonItem = { id: 'si_addon', lookupKey: AI_ADDON_PRICE_LOOKUP_KEY }

  it('adds when absent, and is a noop when already there', () => {
    expect(aiAddonChange([planItem], true)).toEqual({ op: 'add' })
    expect(aiAddonChange([planItem, addonItem], true)).toEqual({ op: 'noop' })
  })

  it('removes exactly the add on item, and is a noop when absent', () => {
    expect(aiAddonChange([planItem, addonItem], false)).toEqual({
      op: 'remove',
      itemId: 'si_addon',
    })
    expect(aiAddonChange([planItem], false)).toEqual({ op: 'noop' })
  })

  it('never touches the plan item, whatever is asked', () => {
    const removal = aiAddonChange([planItem, addonItem], false)
    expect(removal).not.toMatchObject({ itemId: 'si_plan' })
    // Items with no lookup key (a price created by hand) are ignored.
    expect(aiAddonChange([{ id: 'si_x', lookupKey: null }], false)).toEqual({ op: 'noop' })
  })
})
