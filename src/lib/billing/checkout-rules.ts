/**
 * The pure rules of the checkout form (F13 PR 2), separated from the server
 * action the same way cron-auth separates its rule from its route: the
 * action does auth, Stripe, and redirects; every decision that can be
 * unit tested lives here.
 *
 * The clickwrap rule is the one that matters legally (docs/DECISIONS.md
 * 2026-08-07 and the 2026-08-03 browsewrap entry): no acceptance, no
 * checkout session, refused on the server regardless of what the browser
 * claimed. The rest is the frozen pricing's shape: three purchasable plans,
 * and the AI add on attaches to Basic only because Pro and Business already
 * include the allowance.
 */

export type CheckoutPlan = 'basic' | 'pro' | 'business'

export type CheckoutSelection = {
  plan: CheckoutPlan
  aiAddon: boolean
}

/** Input validation failed. Safe to display on the billing form. */
export class CheckoutValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CheckoutValidationError'
  }
}

function isCheckoutPlan(value: string): value is CheckoutPlan {
  return value === 'basic' || value === 'pro' || value === 'business'
}

/**
 * Validates the raw form values into a checkout selection, or throws a
 * CheckoutValidationError whose message is written for the person reading
 * the billing screen.
 */
export function parseCheckoutSelection(input: {
  plan: string
  aiAddon: boolean
  termsAccepted: boolean
}): CheckoutSelection {
  if (!input.termsAccepted) {
    throw new CheckoutValidationError(
      'Please agree to the Terms of Service and Privacy Policy to continue.',
    )
  }
  if (!isCheckoutPlan(input.plan)) {
    throw new CheckoutValidationError('Pick a plan to continue.')
  }
  if (input.aiAddon && input.plan !== 'basic') {
    throw new CheckoutValidationError(
      'The AI Chat add on comes with Basic only. Pro and Business already include managed AI answers.',
    )
  }
  return { plan: input.plan, aiAddon: input.aiAddon }
}

/** The add on's price lookup key. Duplicated from stripe-sync.ts on purpose:
 * this module stays importable outside the server (scripts, tests) while
 * stripe-sync is server only; tests/billing-portal.test.ts pins the two
 * copies together. */
export const AI_ADDON_PRICE_LOOKUP_KEY = 'talvext_ai_addon_monthly'

/** The three purchasable plans' lookup keys, the portal configuration's
 * switching menu. Same duplication contract as the add on key above. */
export const PLAN_PRICE_LOOKUP_KEYS = [
  'talvext_basic_monthly',
  'talvext_pro_monthly',
  'talvext_business_monthly',
] as const

/** The price lookup keys a selection buys, plan first. The keys are the
 * contract with scripts/stripe-seed.ts and src/lib/db/stripe-sync.ts. */
export function lookupKeysForSelection(selection: CheckoutSelection): string[] {
  const keys = [`talvext_${selection.plan}_monthly`]
  if (selection.aiAddon) keys.push(AI_ADDON_PRICE_LOOKUP_KEY)
  return keys
}

// ---------------------------------------------------------------------------
// The AI add on toggle (F13 follow up). The portal cannot manage a second
// subscription item, so adding and removing the add on happens in app; this
// is the decision the action executes.

export type SubscriptionItemFacts = { id: string; lookupKey: string | null }

export type AiAddonChange =
  | { op: 'add' }
  | { op: 'remove'; itemId: string }
  | { op: 'noop' }

/**
 * What to do to a subscription's items to reach the desired add on state.
 * noop when the subscription is already there, so a double submit or a stale
 * form never creates a second add on item or errors on a missing one.
 */
export function aiAddonChange(
  items: SubscriptionItemFacts[],
  enable: boolean,
): AiAddonChange {
  const existing = items.find((item) => item.lookupKey === AI_ADDON_PRICE_LOOKUP_KEY)
  if (enable) return existing ? { op: 'noop' } : { op: 'add' }
  return existing ? { op: 'remove', itemId: existing.id } : { op: 'noop' }
}
