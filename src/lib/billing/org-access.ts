import 'server-only'

import { createAdminClient } from '@/lib/db/admin'
import { resolveEntitlements } from './entitlements'

/**
 * The org count gate (F13 PR 3). The frozen pricing allows one organization
 * per account on Free, Basic, and Pro, and up to ten on Business. Clerk owns
 * org creation end to end (hosted widgets, no server hook before the fact),
 * and its webhook fires after the org already exists, where a refusal would
 * only make Clerk retry forever. So the recorded fallback applies:
 * enforcement happens at first data access, in the dashboard layout, with a
 * clear screen instead of an error.
 *
 * The limit is per PERSON, not per org: which organizations may THIS user
 * work in. A user's allowance is the highest orgLimit across every org they
 * belong to, so a Business account's staff, who must work across up to ten
 * client orgs, inherit the allowance from the Business org's membership. A
 * member who belongs to one org is always allowed, whatever anyone else
 * does; nothing is deleted or locked for other members when one user is
 * over their allowance.
 *
 * Which orgs are "inside" the allowance is deterministic: membership age.
 * The oldest N memberships are in; a newer one shows the screen until the
 * allowance grows or an older membership is left.
 */

export type OrgAccess =
  | { allowed: true }
  | {
      allowed: false
      /** How many organizations this user's plans include. */
      allowance: number
      /** The active org's position among the user's orgs by join date. */
      position: number
      total: number
    }

export async function checkOrgAccess(
  userId: string,
  clerkOrgId: string,
  // Injectable for the isolation suite (the stripe-sync pattern); the layout
  // passes nothing and gets the real admin client.
  db: ReturnType<typeof createAdminClient> = createAdminClient(),
): Promise<OrgAccess> {
  const { data: memberships, error } = await db
    .from('org_members')
    .select('org_id, created_at, organizations!inner(clerk_org_id)')
    .eq('clerk_user_id', userId)
    .order('created_at', { ascending: true })
  if (error) throw error

  // The overwhelmingly common case, decided on one read: one org, allowed,
  // whatever the plan. The deeper reads run only for multi org users.
  if (!memberships || memberships.length <= 1) return { allowed: true }

  const { data: billingRows, error: billingErr } = await db
    .from('org_billing')
    .select('*')
    .in(
      'org_id',
      memberships.map((m) => m.org_id),
    )
  if (billingErr) throw billingErr

  const allowance = Math.max(
    1,
    ...(billingRows ?? []).map((row) => resolveEntitlements(row).orgLimit),
  )

  const position =
    memberships.findIndex((m) => m.organizations.clerk_org_id === clerkOrgId) + 1
  // The active org not appearing among the user's memberships means the
  // webhook has not synced this membership yet; every data path shows the
  // org as empty regardless, so the gate lets the page render rather than
  // blocking a brand new org on webhook lag.
  if (position === 0) return { allowed: true }

  if (position <= allowance) return { allowed: true }
  return { allowed: false, allowance, position, total: memberships.length }
}
