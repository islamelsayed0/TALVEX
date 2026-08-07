import { NextResponse, type NextRequest } from 'next/server'
import type Stripe from 'stripe'

import { createStripeClient, StripeConfigError } from '@/lib/billing/stripe'
import { createAdminClient } from '@/lib/db/admin'
import {
  applyStripeEvent,
  markEventProcessed,
  recordEventSeen,
} from '@/lib/db/stripe-sync'
import { logError, logInfo } from '@/lib/log'

/**
 * Stripe webhook receiver. Writes subscription state into org_billing.
 *
 * This route is public by design, like the Clerk webhook beside it: webhooks
 * carry no user session, so the signature IS the authentication.
 * constructEventAsync checks the Stripe-Signature header against
 * STRIPE_WEBHOOK_SECRET (HMAC over the RAW request body, which is why the
 * body is read as text and never parsed first) and throws on any mismatch,
 * so an unverified payload never reaches the sync logic.
 *
 * Fails closed on missing configuration: without the webhook secret or the
 * API key the route returns 503 without reading the payload at all. There is
 * no unverified mode.
 *
 * Responses: 400 for bad signatures (Stripe will not retry a rejection it
 * caused), 500 for sync failures (Stripe retries with backoff; the ledger in
 * stripe_webhook_events plus idempotent handlers make retries safe, see
 * stripe-sync.ts). Payload contents are never logged; event type and action
 * only (CLAUDE.md: no tenant data in logs).
 */
export async function POST(request: NextRequest) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret || !webhookSecret.trim()) {
    logError('stripe.webhook.failed', 'unavailable', {
      reason: 'STRIPE_WEBHOOK_SECRET is not set',
    })
    return NextResponse.json({ error: 'webhook not configured' }, { status: 503 })
  }

  let stripe
  try {
    stripe = createStripeClient()
  } catch (err) {
    if (err instanceof StripeConfigError) {
      logError('stripe.webhook.failed', 'unavailable', { reason: err.message })
      return NextResponse.json({ error: 'webhook not configured' }, { status: 503 })
    }
    throw err
  }

  const signature = request.headers.get('stripe-signature')
  if (!signature) {
    return NextResponse.json({ error: 'missing signature' }, { status: 400 })
  }

  const payload = await request.text()
  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(payload, signature, webhookSecret)
  } catch {
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 })
  }

  const db = createAdminClient()
  try {
    const seen = await recordEventSeen(db, event)
    if (seen === 'already_processed') {
      logInfo('stripe.webhook.applied', 'ok', {
        event_type: event.type,
        action: 'duplicate ignored',
      })
      return NextResponse.json({ ok: true })
    }

    const result = await applyStripeEvent(db, event, {
      retrieveSubscription: (id) => stripe.subscriptions.retrieve(id),
    })
    await markEventProcessed(db, event.id)
    logInfo('stripe.webhook.applied', 'ok', {
      event_type: event.type,
      action: result.action,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    // The message rather than the name, the clerk webhook's reasoning: a sync
    // failure is usually a Postgres error whose text is the only thing that
    // identifies which constraint bit.
    logError('stripe.webhook.failed', 'failed', {
      event_type: event.type,
      error: err instanceof Error ? err.message : 'unknown error',
    })
    return NextResponse.json({ error: 'sync failed' }, { status: 500 })
  }
}
