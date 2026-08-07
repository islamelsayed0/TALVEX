import { auth } from '@clerk/nextjs/server'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { requireAdmin } from '@/lib/auth/org-viewer'
import {
  AI_ADDON_PRICE_LOOKUP_KEY,
  aiAddonChange,
  formatUsd,
} from '@/lib/billing/checkout-rules'
import { getEntitlements } from '@/lib/billing/entitlements'
import { createStripeClient } from '@/lib/billing/stripe'

import { formatUtc, ghostButton, primaryButton } from '../../../monitors/ui'
import { setAiAddonAction } from '../actions'

export const metadata = { title: 'AI Chat add on — Talvext' }

const PAGE = '/dashboard/settings/billing'

/**
 * The confirmation between the add on button and the money (F13 follow up,
 * docs/DECISIONS.md 2026-08-07): no single click ever changes what an org
 * pays. The billing screen LINKS here; this page shows what the change
 * costs, with Stripe's own invoice preview when it can be fetched (the next
 * invoice's real total, prorations included), and only the Confirm button
 * submits the action that edits the subscription. The release address page
 * is the idiom: its own page, fully server side, primary accent on the
 * confirming button.
 *
 * The preview is best effort on purpose: if the preview call fails, the
 * page still renders the plain arithmetic and the confirm still works.
 * Refusing to confirm because a PREVIEW failed would put the decorative
 * number above the customer's actual intent.
 */

type Preview = {
  nextInvoiceTotal: string
  monthlyAfter: string
}

async function fetchPreview(
  subscriptionId: string,
  customerId: string,
  enable: boolean,
): Promise<Preview | null> {
  try {
    const stripe = createStripeClient()
    const sub = await stripe.subscriptions.retrieve(subscriptionId)
    const items = sub.items.data.map((item) => ({
      id: item.id,
      lookupKey: item.price.lookup_key,
    }))
    const change = aiAddonChange(items, enable)
    if (change.op === 'noop') return null

    let changedItems: Array<{ id?: string; price?: string; deleted?: boolean }>
    let addonUnitAmount = 0
    if (change.op === 'add') {
      const { data: prices } = await stripe.prices.list({
        lookup_keys: [AI_ADDON_PRICE_LOOKUP_KEY],
        limit: 1,
      })
      if (!prices[0]) return null
      changedItems = [{ price: prices[0].id }]
      addonUnitAmount = prices[0].unit_amount ?? 0
    } else {
      changedItems = [{ id: change.itemId, deleted: true }]
    }

    const invoice = await stripe.invoices.createPreview({
      customer: customerId,
      subscription: subscriptionId,
      subscription_details: {
        items: changedItems,
        proration_behavior: 'create_prorations',
      },
    })

    // The recurring total after the change: every item that stays, plus the
    // add on when adding. Real unit amounts, no constants.
    const keptCents = sub.items.data.reduce((sum, item) => {
      const removed =
        change.op === 'remove' && item.id === change.itemId
      return removed ? sum : sum + (item.price.unit_amount ?? 0)
    }, 0)

    return {
      nextInvoiceTotal: formatUsd(invoice.total),
      monthlyAfter: formatUsd(keptCents + (change.op === 'add' ? addonUnitAmount : 0)),
    }
  } catch {
    return null
  }
}

export default async function AddonConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  await requireAdmin()
  const { orgId } = await auth()
  if (!orgId) redirect('/select-org')

  const params = await searchParams
  const op = typeof params.op === 'string' ? params.op : ''
  if (op !== 'add' && op !== 'remove') redirect(PAGE)
  const enable = op === 'add'

  const entitlements = await getEntitlements(orgId)
  // Anything that makes the question moot goes back to the billing screen,
  // which explains the actual state: wrong plan, wrong status, no
  // subscription, or the add on already where the link wanted it.
  if (
    entitlements.plan !== 'basic' ||
    entitlements.status !== 'active' ||
    !entitlements.stripeSubscriptionId ||
    !entitlements.stripeCustomerId ||
    entitlements.aiAddon === enable
  ) {
    redirect(PAGE)
  }

  const preview = await fetchPreview(
    entitlements.stripeSubscriptionId,
    entitlements.stripeCustomerId,
    enable,
  )

  return (
    <main id="main-content" className="flex flex-1 flex-col gap-6 p-8">
      <div className="flex max-w-md flex-col gap-4 rounded-button border border-border bg-card p-6">
        <h1 className="text-title text-card-foreground">
          {enable ? 'Add AI Chat for $15 a month?' : 'Remove the AI Chat add on?'}
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {enable
            ? '300 managed AI answers a month join your Basic plan. The remainder of the current billing period is prorated, so the first charge is smaller than a full month.'
            : 'Managed AI answers stop with the current billing period and the unused time is credited. BYOK chat keeps working exactly as before.'}
        </p>
        {preview ? (
          <p className="text-sm leading-relaxed text-card-foreground">
            Your next invoice, prorations included: {preview.nextInvoiceTotal}.
            After that, {preview.monthlyAfter} a month
            {entitlements.currentPeriodEnd
              ? `, next billed ${formatUtc(entitlements.currentPeriodEnd)}`
              : ''}
            .
          </p>
        ) : (
          <p className="text-sm leading-relaxed text-card-foreground">
            {enable
              ? 'From the next full billing period this comes to $54.00 a month with your Basic plan.'
              : 'From the next billing period your total returns to $39.00 a month.'}
          </p>
        )}
        <form action={setAiAddonAction} className="flex items-center gap-3">
          <input type="hidden" name="addon" value={enable ? 'enable' : 'disable'} />
          <button type="submit" className={primaryButton}>
            {enable ? 'Confirm: add for $15 a month' : 'Confirm: remove it'}
          </button>
          <Link href={PAGE} className={ghostButton}>
            Cancel
          </Link>
        </form>
      </div>
    </main>
  )
}
