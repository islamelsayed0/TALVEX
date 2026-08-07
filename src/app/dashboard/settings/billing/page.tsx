import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'

import { requireAdmin } from '@/lib/auth/org-viewer'
import {
  getEntitlements,
  type BillingPlan,
  type Entitlements,
} from '@/lib/billing/entitlements'
import { StatusText } from '@/components/status-mark'

import { Card } from '../../_overview/ui'
import { formatUtc, ghostButton, primaryButton } from '../../monitors/ui'
import { FormError } from '../../tickets/ui'
import { SettingsNav } from '../nav'
import { openPortalAction, startCheckoutAction } from './actions'
import { PendingRefresh } from './pending-refresh'

export const metadata = { title: 'Settings — Talvext' }

/**
 * The billing screen (F13 PR 2). Admin gated like every settings tab; the
 * page renders what the RESOLVER says, never what a redirect claimed: after
 * a successful checkout the entitlement state is whatever the webhook has
 * written, and until it lands the screen says pending and refreshes itself.
 *
 * Deliberately absent: card fields (Stripe hosts every payment surface),
 * plan change buttons for subscribers (the Stripe portal owns changes and
 * cancellation), and any owner only distinction. Billing is admin gated for
 * v1; owner activation is recorded as deferred in docs/DECISIONS.md
 * 2026-08-07 (PR 2 note).
 */

const PLAN_NAMES: Record<BillingPlan, string> = {
  free: 'Free',
  basic: 'Basic',
  pro: 'Pro',
  business: 'Business',
}

/** What each plan includes, the frozen pricing said out loud. */
const PLAN_INCLUDES: Record<BillingPlan, string[]> = {
  free: ['1 organization', '2 monitors', 'Tickets and incident alerts', 'BYOK AI chat'],
  basic: [
    '1 organization',
    '15 monitors',
    'Status page',
    'Daily digest',
    'SSL expiry warnings',
    'Maintenance windows',
  ],
  pro: [
    '1 organization',
    'Unlimited monitors',
    'Documents with audience targeting, inventory, audit log',
    '300 managed AI answers a month',
  ],
  business: [
    'Up to 10 organizations',
    'Everything in Pro',
    'Manage every client or location from one account',
  ],
}

const TIER_CARDS: Array<{
  plan: BillingPlan & ('basic' | 'pro' | 'business')
  price: string
  blurb: string
}> = [
  {
    plan: 'basic',
    price: '$39',
    blurb: 'For offices up to around 20 staff.',
  },
  {
    plan: 'pro',
    price: '$79',
    blurb: 'Everything unlimited, AI answers included.',
  },
  {
    plan: 'business',
    price: '$199',
    blurb: 'Every client or location, one account.',
  },
]

function planStatus(entitlements: Entitlements) {
  if (entitlements.status === 'past_due') {
    return <StatusText tone="down" label="Payment past due" />
  }
  if (entitlements.status === 'canceled') {
    return <StatusText tone="paused" label="Subscription ended" />
  }
  if (entitlements.plan !== 'free') {
    return <StatusText tone="up" label="Active" />
  }
  return null
}

export default async function BillingSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  await requireAdmin()
  const { orgId } = await auth()
  if (!orgId) redirect('/select-org')

  const params = await searchParams
  const error = typeof params.error === 'string' ? params.error : undefined
  const checkout = typeof params.checkout === 'string' ? params.checkout : undefined

  const entitlements = await getEntitlements(orgId)
  const onPaidPlan = entitlements.plan !== 'free'
  // Success redirect but the webhook has not written entitlements yet: the
  // redirect is not trusted, the database is. Show pending and poll briefly.
  const awaitingWebhook = checkout === 'success' && !onPaidPlan

  return (
    <main
      id="main-content"
      className="mx-auto w-full max-w-[780px] flex-1 animate-fade-up px-8 pt-[30px] pb-[72px]"
    >
      <div className="mb-[22px]">
        <h1 className="text-title text-foreground">Settings</h1>
        <p className="mt-1.5 text-[14px] text-quiet">
          Manage your workspace, team and integrations.
        </p>
      </div>

      <SettingsNav />

      {error ? (
        <div className="mb-[18px]">
          <FormError message={error} />
        </div>
      ) : null}

      {checkout === 'canceled' ? (
        <Card className="mb-[18px] px-[22px] py-4">
          <p className="text-sm text-foreground">
            Checkout was canceled. Nothing changed and nothing was charged.
          </p>
        </Card>
      ) : null}

      {checkout === 'success' && onPaidPlan ? (
        <Card className="mb-[18px] px-[22px] py-4">
          <p className="text-sm text-foreground">
            Your {PLAN_NAMES[entitlements.plan]} plan is active. Thank you.
          </p>
        </Card>
      ) : null}

      {awaitingWebhook ? (
        <Card className="mb-[18px] px-[22px] py-4">
          <StatusText tone="pending" label="Confirming your subscription" />
          <p className="mt-1.5 text-[12.5px] text-quiet">
            Payment went through and Stripe is confirming it to us now. This
            page checks again every few seconds; the plan appears the moment
            the confirmation lands.
          </p>
          <PendingRefresh />
        </Card>
      ) : null}

      <Card className="px-[22px] py-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-base font-semibold text-foreground">
            Current plan: {PLAN_NAMES[entitlements.plan]}
          </h2>
          {planStatus(entitlements)}
        </div>
        <ul className="mt-3 space-y-1">
          {PLAN_INCLUDES[entitlements.plan].map((line) => (
            <li
              key={line}
              className="border-t border-divider py-2 text-[13px] text-foreground first:border-t-0"
            >
              {line}
            </li>
          ))}
          {entitlements.aiAddon ? (
            <li className="border-t border-divider py-2 text-[13px] text-foreground">
              AI Chat add on: 300 managed AI answers a month
            </li>
          ) : null}
        </ul>
        {entitlements.currentPeriodEnd && entitlements.status === 'active' ? (
          <p className="mt-2 text-[12.5px] text-quiet">
            Renews {formatUtc(entitlements.currentPeriodEnd)}.
          </p>
        ) : null}
      </Card>

      {entitlements.status === 'past_due' ? (
        <Card className="mt-[18px] px-[22px] py-4">
          <p className="text-sm text-foreground">
            Your last payment did not go through. Stripe retries the card
            automatically, and you can update it under Manage billing. Nothing
            has been turned off.
          </p>
        </Card>
      ) : null}

      {entitlements.status === 'canceled' ? (
        <Card className="mt-[18px] px-[22px] py-4">
          <p className="text-sm text-foreground">
            Your subscription ended and this organization is on the Free tier.
            Choosing a plan below picks up the same billing account, so your
            invoice history stays in one place.
          </p>
        </Card>
      ) : null}

      {!onPaidPlan && !awaitingWebhook ? (
        <Card className="mt-[18px] px-[22px] py-5">
          <h2 className="text-base font-semibold text-foreground">Upgrade</h2>
          <p className="mt-1 text-[12.5px] text-quiet">
            Incident alerts are included on every tier, always. Seats are never
            counted or charged for.
          </p>

          <form action={startCheckoutAction}>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {TIER_CARDS.map((tier) => (
                <div
                  key={tier.plan}
                  className="flex flex-col rounded-card border border-card-border p-4"
                >
                  <h3 className="text-sm font-semibold text-foreground">
                    {PLAN_NAMES[tier.plan]}
                  </h3>
                  <p className="mt-0.5 text-[13px] text-foreground">
                    {tier.price}
                    <span className="text-quiet"> a month</span>
                  </p>
                  <p className="mt-1.5 flex-1 text-[12.5px] text-quiet">{tier.blurb}</p>
                  {tier.plan === 'basic' ? (
                    <label className="mt-3 flex items-start gap-2 text-[12.5px] text-foreground">
                      <input
                        name="ai_addon"
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 accent-(--status-up)"
                      />
                      Add AI Chat: 300 managed answers a month, $15 a month
                    </label>
                  ) : null}
                  <button
                    type="submit"
                    name="plan"
                    value={tier.plan}
                    className={`${ghostButton} mt-3`}
                  >
                    Choose {PLAN_NAMES[tier.plan]}
                  </button>
                </div>
              ))}
            </div>

            <label className="mt-4 flex items-start gap-2.5 border-t border-divider pt-4 text-sm text-foreground">
              <input
                name="accept_terms"
                type="checkbox"
                required
                className="mt-0.5 h-4 w-4 accent-(--status-up)"
              />
              <span>
                I agree to the{' '}
                <a href="/terms" className="text-link underline hover:text-foreground">
                  Terms of Service
                </a>{' '}
                and{' '}
                <a href="/privacy" className="text-link underline hover:text-foreground">
                  Privacy Policy
                </a>
                .
              </span>
            </label>
          </form>

          <p className="mt-4 border-t border-divider pt-3 text-[12.5px] text-quiet">
            Need more than ten organizations, or something custom?{' '}
            <a
              href="mailto:islamelsayed02@gmail.com"
              className="text-link underline hover:text-foreground"
            >
              Contact us
            </a>
            .
          </p>
        </Card>
      ) : null}

      {entitlements.stripeCustomerId ? (
        <Card className="mt-[18px] px-[22px] py-5">
          <h2 className="text-base font-semibold text-foreground">Manage billing</h2>
          <p className="mt-1 text-[12.5px] text-quiet">
            Payment method, invoices, plan changes and cancellation all happen
            in the Stripe billing portal. No card details ever touch Talvext.
          </p>
          <form action={openPortalAction} className="mt-3">
            <button type="submit" className={primaryButton}>
              Manage billing
            </button>
          </form>
        </Card>
      ) : null}

      <p className="mt-[18px] text-[12px] text-quiet">
        Billing runs in Stripe test mode while Talvext is prelaunch; no real
        card is ever charged. BYOK chat stays free on every tier and is never
        capped.
      </p>
    </main>
  )
}
