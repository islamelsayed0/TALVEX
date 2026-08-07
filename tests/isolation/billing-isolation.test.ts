import { randomUUID } from 'node:crypto'

import type Stripe from 'stripe'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { resolveEntitlements } from '@/lib/billing/entitlements'
import {
  applyStripeEvent,
  markEventProcessed,
  recordEventSeen,
} from '@/lib/db/stripe-sync'
import {
  CLAIM_SHAPES,
  createAnonClient,
  createMemberClient,
  createServiceClient,
  memberToken,
  orglessToken,
  preflight,
  type TestClient,
} from './local-stack'

// Isolation proof for billing entitlements (migration 022, F13 PR 1).
// Extends the suite per CLAUDE.md rules 2 and 8 (never skip, weaken, or
// delete). Under test:
//
//   - ORG_BILLING IS READ ONLY FOR ADMINS OF THE OWNING ORG: an org admin
//     selects their own org's row and nobody else's, in either Clerk claim
//     shape; a member selects nothing; an admin CLAIM on a member column
//     grants nothing (the column is the authority).
//   - NO USER SESSION HOLDS A WRITE VERB: insert, update, and delete are
//     refused at the verb (42501), the owning org's admin included. A
//     writable billing row would let a tenant grant itself a plan.
//   - THE EVENTS LEDGER IS SERVICE ROLE TERRITORY OUTRIGHT: authenticated
//     and anon hold no verb at all on stripe_webhook_events, select included.
//   - THE WEBHOOK SYNC WRITES WHAT THE RESOLVER READS: applyStripeEvent is
//     driven with hand built Stripe events against the local stack, through
//     the same service role posture the route uses, and the resulting rows
//     resolve to the entitlements the frozen pricing promises. The clickwrap
//     record survives every webhook write because the sync never names those
//     columns.
//   - DELIVERY BOOKKEEPING: seen and done are separate states, a finished
//     duplicate is recognized, an unfinished one is offered for reprocessing.

const runId = randomUUID()
const seed = {
  orgA: { clerk_org_id: `org_billing_a_${runId}`, name: 'Billing Test Org A' },
  orgB: { clerk_org_id: `org_billing_b_${runId}`, name: 'Billing Test Org B' },
  orgC: { clerk_org_id: `org_billing_c_${runId}`, name: 'Billing Test Org C' },
  adminA: `user_billing_admin_a_${runId}`,
  memberA: `user_billing_member_a_${runId}`,
  adminB: `user_billing_admin_b_${runId}`,
}

let service: TestClient
let orgAId: string
let orgBId: string
let orgCId: string
let seeded = false

const asUser = (
  clerkUserId: string,
  clerkOrgId: string,
  shape: (typeof CLAIM_SHAPES)[number],
  claimRole?: 'member' | 'admin',
) => createMemberClient(memberToken({ clerkUserId, clerkOrgId, shape, claimRole }))

/** A subscription shaped as the webhook sees one. */
function subscription(opts: {
  id: string
  customer: string
  clerkOrgId?: string
  lookupKeys: string[]
  status?: Stripe.Subscription.Status
}): Stripe.Subscription {
  return {
    id: opts.id,
    object: 'subscription',
    status: opts.status ?? 'active',
    customer: opts.customer,
    metadata: opts.clerkOrgId ? { clerk_org_id: opts.clerkOrgId } : {},
    items: {
      object: 'list',
      data: opts.lookupKeys.map((lookupKey, i) => ({
        id: `si_${i}`,
        object: 'subscription_item',
        current_period_end: 1_790_000_000,
        price: { id: `price_${i}`, object: 'price', lookup_key: lookupKey },
      })),
    },
  } as unknown as Stripe.Subscription
}

let eventCounter = 0
function event(type: string, object: unknown): Stripe.Event {
  eventCounter += 1
  return {
    id: `evt_${runId}_${eventCounter}`,
    object: 'event',
    type,
    data: { object },
  } as unknown as Stripe.Event
}

const noRetrieve = {
  retrieveSubscription: () => {
    throw new Error('this test path must not call Stripe')
  },
}

beforeAll(async () => {
  await preflight()
  service = createServiceClient()

  const { data: orgs, error: orgErr } = await service
    .from('organizations')
    .insert([seed.orgA, seed.orgB, seed.orgC])
    .select()
  if (orgErr || orgs.length !== 3) {
    throw new Error(`Seeding organizations failed: ${orgErr?.message}`)
  }
  const idFor = (clerkOrgId: string) =>
    orgs.find((o) => o.clerk_org_id === clerkOrgId)!.id
  orgAId = idFor(seed.orgA.clerk_org_id)
  orgBId = idFor(seed.orgB.clerk_org_id)
  orgCId = idFor(seed.orgC.clerk_org_id)

  const { error: memberErr } = await service.from('org_members').insert([
    { org_id: orgAId, clerk_user_id: seed.adminA, role: 'admin' },
    { org_id: orgAId, clerk_user_id: seed.memberA, role: 'member' },
    { org_id: orgBId, clerk_user_id: seed.adminB, role: 'admin' },
  ])
  if (memberErr) throw new Error(`Seeding org_members failed: ${memberErr.message}`)

  // Billing rows as the webhook would write them: A on Pro, B on Basic.
  const { error: billingErr } = await service.from('org_billing').insert([
    {
      org_id: orgAId,
      stripe_customer_id: `cus_a_${runId}`,
      stripe_subscription_id: `sub_a_${runId}`,
      plan: 'pro',
      status: 'active',
      ai_answers_included: 300,
      ai_addon: false,
      org_limit: 1,
      monitor_limit: null,
    },
    {
      org_id: orgBId,
      stripe_customer_id: `cus_b_${runId}`,
      stripe_subscription_id: `sub_b_${runId}`,
      plan: 'basic',
      status: 'active',
      ai_answers_included: 0,
      ai_addon: false,
      org_limit: 1,
      monitor_limit: 15,
    },
  ])
  if (billingErr) throw new Error(`Seeding org_billing failed: ${billingErr.message}`)

  seeded = true
}, 60_000)

afterAll(async () => {
  if (!seeded) return
  await service
    .from('organizations')
    .delete()
    .in('clerk_org_id', [
      seed.orgA.clerk_org_id,
      seed.orgB.clerk_org_id,
      seed.orgC.clerk_org_id,
    ])
  await service.from('stripe_webhook_events').delete().like('id', `evt_${runId}_%`)
})

describe.each(CLAIM_SHAPES)('org_billing reads (%s claim shape)', (shape) => {
  it('an org admin reads their own org billing row and only theirs', async () => {
    const { data, error } = await asUser(seed.adminA, seed.orgA.clerk_org_id, shape)
      .from('org_billing')
      .select('org_id, plan')
    expect(error).toBeNull()
    expect(data).toEqual([{ org_id: orgAId, plan: 'pro' }])
  })

  it('a member reads nothing: billing is an administration surface', async () => {
    const { data, error } = await asUser(seed.memberA, seed.orgA.clerk_org_id, shape)
      .from('org_billing')
      .select('org_id')
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('an admin token CLAIM does not grant access when the column says member', async () => {
    const { data } = await asUser(seed.memberA, seed.orgA.clerk_org_id, shape, 'admin')
      .from('org_billing')
      .select('org_id')
    expect(data).toEqual([])
  })

  it('cross org: org B admin cannot see org A billing even by id', async () => {
    const { data, error } = await asUser(seed.adminB, seed.orgB.clerk_org_id, shape)
      .from('org_billing')
      .select('org_id, plan')
      .eq('org_id', orgAId)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })
})

describe('org_billing writes are refused at the verb for every user session', () => {
  it('the owning org admin cannot insert, update, or delete', async () => {
    const admin = asUser(seed.adminA, seed.orgA.clerk_org_id, 'legacy')

    const { error: insErr } = await admin
      .from('org_billing')
      .insert({ org_id: orgAId, plan: 'business' })
    expect(insErr).not.toBeNull()
    expect(insErr!.code).toBe('42501')

    const { error: upErr } = await admin
      .from('org_billing')
      .update({ plan: 'business', ai_answers_included: 100000 })
      .eq('org_id', orgAId)
    expect(upErr).not.toBeNull()
    expect(upErr!.code).toBe('42501')

    const { error: delErr } = await admin.from('org_billing').delete().eq('org_id', orgAId)
    expect(delErr).not.toBeNull()
    expect(delErr!.code).toBe('42501')

    const { data: after } = await service
      .from('org_billing')
      .select('plan, ai_answers_included')
      .eq('org_id', orgAId)
      .single()
    expect(after).toEqual({ plan: 'pro', ai_answers_included: 300 })
  })

  it('an org less session reads nothing, silently', async () => {
    const { data, error } = await createMemberClient(orglessToken(seed.adminA))
      .from('org_billing')
      .select('org_id')
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('anon holds no verb at all', async () => {
    const { error } = await createAnonClient().from('org_billing').select('org_id')
    expect(error).not.toBeNull()
    expect(error!.code).toBe('42501')
  })
})

describe('stripe_webhook_events is service role territory outright', () => {
  it('authenticated cannot even select, admin included', async () => {
    const { error } = await asUser(seed.adminA, seed.orgA.clerk_org_id, 'v2')
      .from('stripe_webhook_events')
      .select('id')
    expect(error).not.toBeNull()
    expect(error!.code).toBe('42501')
  })

  it('authenticated cannot insert a fake delivery', async () => {
    const { error } = await asUser(seed.adminA, seed.orgA.clerk_org_id, 'legacy')
      .from('stripe_webhook_events')
      .insert({ id: `evt_forged_${runId}`, event_type: 'checkout.session.completed' })
    expect(error).not.toBeNull()
    expect(error!.code).toBe('42501')
  })

  it('anon gets the same refusal', async () => {
    const { error } = await createAnonClient().from('stripe_webhook_events').select('id')
    expect(error).not.toBeNull()
    expect(error!.code).toBe('42501')
  })
})

describe('delivery bookkeeping: seen and done are separate states', () => {
  it('new, then seen unprocessed, then already processed', async () => {
    const evt = event('customer.subscription.updated', {})

    expect(await recordEventSeen(service, evt)).toBe('new')
    // The same delivery again before processing finished: offered for
    // reprocessing, which is safe because handlers are idempotent upserts.
    expect(await recordEventSeen(service, evt)).toBe('seen_unprocessed')

    await markEventProcessed(service, evt.id)
    expect(await recordEventSeen(service, evt)).toBe('already_processed')
  })
})

describe('the webhook sync writes what the resolver reads', () => {
  it('checkout lands entitlements without touching the clickwrap record', async () => {
    // The checkout action stamped clickwrap before any Stripe session
    // existed; the webhook then writes entitlements. The sync never names
    // the clickwrap columns, so the record survives.
    const accepted = '2026-08-07T09:00:00+00:00'
    const { error: preErr } = await service.from('org_billing').insert({
      org_id: orgCId,
      clickwrap_accepted_at: accepted,
      clickwrap_terms_version: '2026-08-01',
    })
    expect(preErr).toBeNull()

    const subId = `sub_c_${runId}`
    const custId = `cus_c_${runId}`
    const session = {
      id: `cs_${runId}`,
      object: 'checkout.session',
      mode: 'subscription',
      customer: custId,
      subscription: subId,
      metadata: { clerk_org_id: seed.orgC.clerk_org_id },
    }
    const result = await applyStripeEvent(
      service,
      event('checkout.session.completed', session),
      {
        retrieveSubscription: async () =>
          subscription({
            id: subId,
            customer: custId,
            clerkOrgId: seed.orgC.clerk_org_id,
            lookupKeys: ['talvext_basic_monthly', 'talvext_ai_addon_monthly'],
          }),
      },
    )
    expect(result.action).toBe('checkout applied')

    const { data: row } = await service
      .from('org_billing')
      .select('*')
      .eq('org_id', orgCId)
      .single()
    expect(row).toMatchObject({
      plan: 'basic',
      status: 'active',
      ai_addon: true,
      ai_answers_included: 300,
      monitor_limit: 15,
      org_limit: 1,
      stripe_customer_id: custId,
      stripe_subscription_id: subId,
      clickwrap_accepted_at: accepted,
      clickwrap_terms_version: '2026-08-01',
    })

    const entitlements = resolveEntitlements(row)
    expect(entitlements.plan).toBe('basic')
    expect(entitlements.aiAnswersIncluded).toBe(300)
    expect(entitlements.dailyDigest).toBe(true)
  })

  it('a subscription update moves the plan', async () => {
    const result = await applyStripeEvent(
      service,
      event(
        'customer.subscription.updated',
        subscription({
          id: `sub_c_${runId}`,
          customer: `cus_c_${runId}`,
          clerkOrgId: seed.orgC.clerk_org_id,
          lookupKeys: ['talvext_business_monthly'],
        }),
      ),
      noRetrieve,
    )
    expect(result.action).toBe('subscription applied')

    const { data: row } = await service
      .from('org_billing')
      .select('plan, org_limit, monitor_limit, ai_answers_included, ai_addon')
      .eq('org_id', orgCId)
      .single()
    expect(row).toEqual({
      plan: 'business',
      org_limit: 10,
      monitor_limit: null,
      ai_answers_included: 300,
      ai_addon: false,
    })
  })

  it('a payment failure marks past_due and the resolver keeps entitlements', async () => {
    const result = await applyStripeEvent(
      service,
      event('invoice.payment_failed', {
        id: `in_${runId}`,
        object: 'invoice',
        customer: `cus_c_${runId}`,
      }),
      noRetrieve,
    )
    expect(result.action).toBe('payment failure recorded')

    const { data: row } = await service
      .from('org_billing')
      .select('*')
      .eq('org_id', orgCId)
      .single()
    expect(row!.status).toBe('past_due')
    expect(resolveEntitlements(row).monitorLimit).toBeNull()
  })

  it('a subscription delete drops to free, keeps the customer and the clickwrap', async () => {
    const result = await applyStripeEvent(
      service,
      event(
        'customer.subscription.deleted',
        subscription({
          id: `sub_c_${runId}`,
          customer: `cus_c_${runId}`,
          lookupKeys: ['talvext_business_monthly'],
          status: 'canceled',
        }),
      ),
      noRetrieve,
    )
    expect(result.action).toBe('subscription canceled')

    const { data: row } = await service
      .from('org_billing')
      .select('*')
      .eq('org_id', orgCId)
      .single()
    expect(row).toMatchObject({
      plan: 'free',
      status: 'canceled',
      ai_addon: false,
      ai_answers_included: 0,
      monitor_limit: 2,
      stripe_subscription_id: null,
      stripe_customer_id: `cus_c_${runId}`,
      clickwrap_accepted_at: '2026-08-07T09:00:00+00:00',
    })

    const entitlements = resolveEntitlements(row)
    expect(entitlements.plan).toBe('free')
    expect(entitlements.monitorLimit).toBe(2)
    expect(entitlements.stripeCustomerId).toBe(`cus_c_${runId}`)
  })

  it('an unattributable subscription event is ignored, not an error', async () => {
    const result = await applyStripeEvent(
      service,
      event(
        'customer.subscription.updated',
        subscription({
          id: `sub_stranger_${runId}`,
          customer: `cus_stranger_${runId}`,
          lookupKeys: ['talvext_pro_monthly'],
        }),
      ),
      noRetrieve,
    )
    expect(result.action).toBe('subscription ignored, no owning org')
  })

  it('a subscription with no talvext price is not ours and writes nothing', async () => {
    const result = await applyStripeEvent(
      service,
      event(
        'customer.subscription.updated',
        subscription({
          id: `sub_foreign_${runId}`,
          customer: `cus_a_${runId}`,
          lookupKeys: ['someone_elses_price'],
        }),
      ),
      noRetrieve,
    )
    expect(result.action).toBe('subscription ignored, no talvext price')

    const { data: row } = await service
      .from('org_billing')
      .select('plan')
      .eq('org_id', orgAId)
      .single()
    expect(row!.plan).toBe('pro')
  })
})

describe('the clickwrap write (F13 PR 2) touches acceptance and nothing else', () => {
  it('first acceptance creates a row whose entitlements default to free', async () => {
    const { recordClickwrapAcceptance } = await import('@/lib/db/billing')
    const clerkOrgId = `org_billing_d_${runId}`
    const { data: org } = await service
      .from('organizations')
      .insert({ clerk_org_id: clerkOrgId, name: 'Billing Test Org D' })
      .select('id')
      .single()

    await recordClickwrapAcceptance(service, org!.id, '2026-08-03')

    const { data: row } = await service
      .from('org_billing')
      .select('*')
      .eq('org_id', org!.id)
      .single()
    expect(row).toMatchObject({
      plan: 'free',
      status: 'active',
      // Migration 023: the default is the free tier's 2, so a row created
      // by accepting terms never reads as unlimited (NULL) before checkout.
      monitor_limit: 2,
      clickwrap_terms_version: '2026-08-03',
    })
    expect(row!.clickwrap_accepted_at).not.toBeNull()
    // And the resolver agrees: no plan was granted by accepting terms.
    expect(resolveEntitlements(row).monitorLimit).toBe(2)

    await service.from('organizations').delete().eq('clerk_org_id', clerkOrgId)
  })

  it('a later acceptance refreshes the record without disturbing webhook written entitlements', async () => {
    const { recordClickwrapAcceptance } = await import('@/lib/db/billing')
    // Org A holds webhook shaped Pro entitlements from the seed.
    await recordClickwrapAcceptance(service, orgAId, '2026-12-31')

    const { data: row } = await service
      .from('org_billing')
      .select('plan, status, ai_answers_included, monitor_limit, stripe_customer_id, clickwrap_terms_version')
      .eq('org_id', orgAId)
      .single()
    expect(row).toEqual({
      plan: 'pro',
      status: 'active',
      ai_answers_included: 300,
      monitor_limit: null,
      stripe_customer_id: `cus_a_${runId}`,
      clickwrap_terms_version: '2026-12-31',
    })
  })
})
