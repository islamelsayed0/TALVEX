import 'server-only'

import type { createAdminClient } from './admin'

/**
 * Typed data layer for the billing rows the checkout path writes (F13 PR 2).
 *
 * One write lives here: the clickwrap acceptance record. It runs on the
 * service role because no user session holds a write verb on org_billing
 * (migration 022); the checkout server action is the only caller, it has
 * already proven the viewer is an admin of the org, and it records the
 * acceptance BEFORE any Stripe session exists, so there is never a
 * subscription whose terms were not accepted first.
 *
 * The client is a parameter, the stripe-sync.ts pattern, so the isolation
 * suite drives this against the local stack; the action passes
 * createAdminClient().
 */

type Db = ReturnType<typeof createAdminClient>

/** The org's internal uuid for a Clerk org id, or null while the Clerk
 * webhook has not synced the org yet. */
export async function billingOrgUuid(db: Db, clerkOrgId: string): Promise<string | null> {
  const { data, error } = await db
    .from('organizations')
    .select('id')
    .eq('clerk_org_id', clerkOrgId)
    .maybeSingle()
  if (error) throw error
  return data?.id ?? null
}

/**
 * Stamps the org's acceptance of the terms. An upsert touching ONLY the
 * clickwrap columns: on an org's first checkout it creates the row (whose
 * entitlement columns default to free until the webhook writes real ones),
 * and on a later checkout it refreshes the acceptance without disturbing
 * whatever entitlements the webhook has written.
 */
export async function recordClickwrapAcceptance(
  db: Db,
  orgId: string,
  termsVersion: string,
): Promise<void> {
  const { error } = await db.from('org_billing').upsert(
    {
      org_id: orgId,
      clickwrap_accepted_at: new Date().toISOString(),
      clickwrap_terms_version: termsVersion,
    },
    { onConflict: 'org_id' },
  )
  if (error) throw error
}
