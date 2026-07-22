import 'server-only'

import type { WebhookEvent } from '@clerk/nextjs/webhooks'

import { createAdminClient } from './admin'
import type { OrgMemberRole } from './types'

/**
 * Applies a verified Clerk webhook event to the database.
 *
 * Runs on the service role client because a webhook carries no user session:
 * there is no token to scope by, which is exactly the narrow case admin.ts
 * exists for. Signature verification happens in the route handler BEFORE
 * anything here runs; this module trusts its input on that basis alone.
 *
 * Handlers are written to be idempotent (upserts, delete-if-exists) because
 * Clerk retries deliveries on non-2xx responses and duplicates are expected.
 */

/**
 * Clerk org roles arrive namespaced ('org:admin'). The app's role vocabulary
 * (owner/admin/technician/member, org_members.role check constraint) is
 * app level; owner and technician are assigned in app, never by Clerk.
 * Exported for tests.
 */
export function mapClerkRole(clerkRole: string): OrgMemberRole {
  switch (clerkRole) {
    case 'org:admin':
    case 'admin':
      return 'admin'
    default:
      return 'member'
  }
}

/** Result of handling one event; the route logs this, never the payload. */
export type SyncResult = { action: string; clerkOrgId?: string }

export async function applyClerkEvent(evt: WebhookEvent): Promise<SyncResult> {
  const db = createAdminClient()

  switch (evt.type) {
    case 'organization.created':
    case 'organization.updated': {
      const { error } = await db.from('organizations').upsert(
        { clerk_org_id: evt.data.id, name: evt.data.name },
        { onConflict: 'clerk_org_id' },
      )
      if (error) throw error
      return { action: 'org upserted', clerkOrgId: evt.data.id }
    }

    case 'organization.deleted': {
      if (!evt.data.id) return { action: 'org delete ignored, no id' }
      // Cascades to org_members via the FK.
      const { error } = await db
        .from('organizations')
        .delete()
        .eq('clerk_org_id', evt.data.id)
      if (error) throw error
      return { action: 'org deleted', clerkOrgId: evt.data.id }
    }

    case 'organizationMembership.created':
    case 'organizationMembership.updated': {
      const clerkOrgId = evt.data.organization.id
      // The org row may not exist yet: Clerk does not guarantee event order
      // and organization.created can arrive after the first membership event.
      // Upserting the org here makes ordering irrelevant.
      const { data: org, error: orgError } = await db
        .from('organizations')
        .upsert(
          { clerk_org_id: clerkOrgId, name: evt.data.organization.name },
          { onConflict: 'clerk_org_id' },
        )
        .select('id')
        .single()
      if (orgError) throw orgError

      const { error } = await db.from('org_members').upsert(
        {
          org_id: org.id,
          clerk_user_id: evt.data.public_user_data.user_id,
          role: mapClerkRole(evt.data.role),
        },
        { onConflict: 'org_id,clerk_user_id' },
      )
      if (error) throw error
      return { action: 'membership upserted', clerkOrgId }
    }

    case 'organizationMembership.deleted': {
      const clerkOrgId = evt.data.organization.id
      const { data: org, error: orgError } = await db
        .from('organizations')
        .select('id')
        .eq('clerk_org_id', clerkOrgId)
        .maybeSingle()
      if (orgError) throw orgError
      if (!org) return { action: 'membership delete ignored, org unknown', clerkOrgId }

      const { error } = await db
        .from('org_members')
        .delete()
        .eq('org_id', org.id)
        .eq('clerk_user_id', evt.data.public_user_data.user_id)
      if (error) throw error
      return { action: 'membership deleted', clerkOrgId }
    }

    default:
      // Signed and valid, just not an event this sync cares about.
      return { action: `ignored ${evt.type}` }
  }
}
