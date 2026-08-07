'use server'

import { auth } from '@clerk/nextjs/server'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { TERMS_EFFECTIVE } from '@/app/(legal)/_content/terms'
import {
  CheckoutValidationError,
  lookupKeysForSelection,
  parseCheckoutSelection,
} from '@/lib/billing/checkout-rules'
import { getEntitlements } from '@/lib/billing/entitlements'
import { createStripeClient } from '@/lib/billing/stripe'
import { createAdminClient } from '@/lib/db/admin'
import { billingOrgUuid, recordClickwrapAcceptance } from '@/lib/db/billing'
import { getActiveOrgViewer } from '@/lib/auth/org-viewer'
import { errorName, logError } from '@/lib/log'

/**
 * The two billing server actions (F13 PR 2): start a Stripe Checkout
 * session, and open the Stripe customer portal. No card field ever exists in
 * this app; both actions end in a redirect to a Stripe hosted page.
 *
 * THE CLICKWRAP GATE lives in startCheckoutAction and its order is the whole
 * point: validate the acceptance (refusing without it, whatever the browser
 * claimed), record it on the org's billing row with the terms version, and
 * only then create the checkout session. There is never a subscription whose
 * terms were not accepted first. See docs/DECISIONS.md 2026-08-07.
 *
 * Failures reach the screen through the query string (the settings actions
 * pattern); Stripe error text never does, because it can quote request
 * details. The generic copy is honest about what did not happen.
 */

const PAGE = '/dashboard/settings/billing'

/** Where Stripe sends the browser back. Built from the request's own host so
 * preview deployments return to themselves. */
async function returnBase(): Promise<string> {
  const h = await headers()
  const origin = h.get('origin')
  if (origin) return origin
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? 'https'
  return `${proto}://${host}`
}

const GENERIC_CHECKOUT_FAILURE =
  'Checkout could not be started and nothing was charged. Try again in a moment; if it keeps failing, tell us on the Get Help page.'

export async function startCheckoutAction(formData: FormData): Promise<void> {
  const viewer = await getActiveOrgViewer()
  if (!viewer.isAdmin) redirect(PAGE)
  const { orgId: clerkOrgId } = await auth()
  if (!clerkOrgId) redirect('/select-org')

  let failure: string | null = null
  let checkoutUrl: string | null = null
  try {
    const selection = parseCheckoutSelection({
      plan: String(formData.get('plan') ?? ''),
      aiAddon: formData.get('ai_addon') === 'on',
      termsAccepted: formData.get('accept_terms') === 'on',
    })

    const entitlements = await getEntitlements(clerkOrgId)
    if (entitlements.plan !== 'free') {
      throw new CheckoutValidationError(
        'This organization already has a plan. Plan changes and cancellation live in Manage billing.',
      )
    }

    const db = createAdminClient()
    const orgUuid = await billingOrgUuid(db, clerkOrgId)
    if (!orgUuid) {
      // The Clerk webhook has not landed this org yet; a retry moments later
      // succeeds. Refusing beats checking out an org we cannot entitle.
      throw new CheckoutValidationError(
        'Your organization is still being set up. Try again in a moment.',
      )
    }

    // The legal gate, recorded BEFORE any Stripe session exists.
    await recordClickwrapAcceptance(db, orgUuid, TERMS_EFFECTIVE)

    const stripe = createStripeClient()
    const keys = lookupKeysForSelection(selection)
    const { data: prices } = await stripe.prices.list({ lookup_keys: keys, limit: 10 })
    const priceByKey = new Map(prices.map((p) => [p.lookup_key, p.id]))
    const lineItems = keys.map((key) => {
      const priceId = priceByKey.get(key)
      if (!priceId) throw new Error(`price missing for lookup key ${key}`)
      return { price: priceId, quantity: 1 }
    })

    const base = await returnBase()
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: lineItems,
      // The org id rides on the session AND the subscription so the webhook
      // can attribute either event shape (stripe-sync.ts).
      client_reference_id: clerkOrgId,
      metadata: { clerk_org_id: clerkOrgId },
      subscription_data: { metadata: { clerk_org_id: clerkOrgId } },
      // Reuse the org's customer if one exists (a canceled subscriber coming
      // back), so their invoice history stays in one place.
      ...(entitlements.stripeCustomerId
        ? { customer: entitlements.stripeCustomerId }
        : {}),
      success_url: `${base}${PAGE}?checkout=success`,
      cancel_url: `${base}${PAGE}?checkout=canceled`,
    })
    if (!session.url) throw new Error('checkout session has no url')
    checkoutUrl = session.url
  } catch (err) {
    if (err instanceof CheckoutValidationError) {
      failure = err.message
    } else {
      logError('billing.checkout.failed', 'failed', { error: errorName(err) })
      failure = GENERIC_CHECKOUT_FAILURE
    }
  }

  if (failure !== null) {
    redirect(`${PAGE}?${new URLSearchParams({ error: failure })}`)
  }
  redirect(checkoutUrl!)
}

export async function openPortalAction(): Promise<void> {
  const viewer = await getActiveOrgViewer()
  if (!viewer.isAdmin) redirect(PAGE)
  const { orgId: clerkOrgId } = await auth()
  if (!clerkOrgId) redirect('/select-org')

  let failure: string | null = null
  let portalUrl: string | null = null
  try {
    const entitlements = await getEntitlements(clerkOrgId)
    if (!entitlements.stripeCustomerId) {
      throw new CheckoutValidationError(
        'There is no billing account for this organization yet. Choosing a plan creates one.',
      )
    }
    const stripe = createStripeClient()
    const base = await returnBase()
    const session = await stripe.billingPortal.sessions.create({
      customer: entitlements.stripeCustomerId,
      return_url: `${base}${PAGE}`,
    })
    portalUrl = session.url
  } catch (err) {
    if (err instanceof CheckoutValidationError) {
      failure = err.message
    } else {
      logError('billing.portal.failed', 'failed', { error: errorName(err) })
      failure =
        'The billing portal could not be opened. Try again in a moment; if it keeps failing, tell us on the Get Help page.'
    }
  }

  if (failure !== null) {
    redirect(`${PAGE}?${new URLSearchParams({ error: failure })}`)
  }
  revalidatePath(PAGE)
  redirect(portalUrl!)
}
