import { verifyWebhook } from '@clerk/nextjs/webhooks'
import { NextResponse, type NextRequest } from 'next/server'

import { applyClerkEvent } from '@/lib/db/clerk-sync'
import { logError, logInfo } from '@/lib/log'

/**
 * Clerk webhook receiver. Syncs organizations and memberships into Postgres.
 *
 * This route is public by design: webhooks carry no user session, so the
 * signature IS the authentication. verifyWebhook checks the svix signature
 * headers against CLERK_WEBHOOK_SIGNING_SECRET and throws on any mismatch,
 * so an unverified payload never reaches the sync logic.
 *
 * Responses: 400 for bad signatures (Clerk will not retry a rejection it
 * caused), 500 for sync failures (Clerk retries with backoff, and the sync
 * is idempotent so retries are safe). Payload contents are never logged;
 * event type and org id only (CLAUDE.md: no tenant data in logs).
 */
export async function POST(request: NextRequest) {
  let evt
  try {
    evt = await verifyWebhook(request)
  } catch {
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 })
  }

  try {
    const result = await applyClerkEvent(evt)
    logInfo('clerk.webhook.applied', 'ok', { event_type: evt.type, action: result.action })
    return NextResponse.json({ ok: true })
  } catch (err) {
    // The message rather than the name, preserving what this route logged
    // before the logger existed: a sync failure is usually a Postgres error
    // whose text is the only thing that identifies which constraint bit.
    logError('clerk.webhook.failed', 'failed', {
      event_type: evt.type,
      error: err instanceof Error ? err.message : 'unknown error',
    })
    return NextResponse.json({ error: 'sync failed' }, { status: 500 })
  }
}
