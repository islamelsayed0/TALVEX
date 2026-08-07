import type Stripe from 'stripe'

import { PLAN_PRICE_LOOKUP_KEYS } from './checkout-rules'

/**
 * The Stripe customer portal configuration, in code (F13 follow up,
 * docs/DECISIONS.md 2026-08-07). The portal is where subscribers switch
 * plans, update cards, read invoices, and cancel; what it offers is a
 * CONFIGURATION object in Stripe, and hand building that in the dashboard is
 * the same trap as hand building the catalog. So it lives here, the seed
 * script philosophy applied to the portal: reproducible from zero, and the
 * portal action self heals by creating it when none exists.
 *
 * Deliberately configured:
 *   - Plan switching between the three plan prices only. The AI add on is a
 *     second subscription item, and Stripe's portal does not manage multi
 *     item subscriptions; the add on toggle in the app owns that instead.
 *   - Cancellation at period end, never immediate: the subscriber keeps what
 *     they paid for, and entitlements drop when the deletion event lands.
 *   - No 'server-only' import here so scripts/stripe-seed.ts can call
 *     ensurePortalConfiguration too; nothing in this module reads env.
 */

/** How our configuration is recognized among any others on the account. */
export const PORTAL_HEADLINE = 'Talvext billing'

/** Pure builder, unit tested; products come from the live catalog. */
export function portalConfigurationParams(
  products: Array<{ product: string; price: string }>,
): Stripe.BillingPortal.ConfigurationCreateParams {
  return {
    business_profile: {
      headline: PORTAL_HEADLINE,
      privacy_policy_url: 'https://talvext.com/privacy',
      terms_of_service_url: 'https://talvext.com/terms',
    },
    features: {
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: 'at_period_end' },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ['price'],
        proration_behavior: 'create_prorations',
        products: products.map(({ product, price }) => ({
          product,
          prices: [price],
        })),
      },
    },
  }
}

/** Whether a live configuration's switching menu matches the desired one.
 * Exported for the unit suite; order insensitive on products. */
export function portalProductsMatch(
  config: Stripe.BillingPortal.Configuration,
  desired: Stripe.BillingPortal.ConfigurationCreateParams,
): boolean {
  const flatten = (
    products:
      | Array<{ product: string; prices: string[] }>
      | null
      | undefined,
  ) =>
    (products ?? [])
      .map((p) => `${p.product}:${[...p.prices].sort().join(',')}`)
      .sort()
      .join('|')
  return (
    flatten(config.features?.subscription_update?.products) ===
    flatten(desired.features?.subscription_update?.products as never)
  )
}

/**
 * Finds our portal configuration, creating it from the live catalog when it
 * does not exist, and UPDATING it in place when its switching menu no longer
 * matches this file (a replaced price would otherwise leave the portal
 * offering the stale one forever, the dashboard drift trap this module
 * exists to kill). Requires the catalog to be seeded (npm run stripe:seed);
 * throws a plain message when it is not, because a portal that cannot offer
 * the plans is worse than an honest failure.
 */
export async function ensurePortalConfiguration(
  stripe: Stripe,
): Promise<Stripe.BillingPortal.Configuration> {
  const { data: prices } = await stripe.prices.list({
    lookup_keys: [...PLAN_PRICE_LOOKUP_KEYS],
    limit: 10,
  })
  if (prices.length !== PLAN_PRICE_LOOKUP_KEYS.length) {
    throw new Error(
      'the plan prices are missing from this Stripe account; run npm run stripe:seed first',
    )
  }
  const desired = portalConfigurationParams(
    prices.map((price) => ({
      product: typeof price.product === 'string' ? price.product : price.product.id,
      price: price.id,
    })),
  )

  const existing = await stripe.billingPortal.configurations.list({
    active: true,
    limit: 100,
  })
  const ours = existing.data.find(
    (config) => config.business_profile?.headline === PORTAL_HEADLINE,
  )
  if (!ours) return stripe.billingPortal.configurations.create(desired)
  if (portalProductsMatch(ours, desired)) return ours
  return stripe.billingPortal.configurations.update(ours.id, {
    business_profile: desired.business_profile,
    features: desired.features,
  })
}
