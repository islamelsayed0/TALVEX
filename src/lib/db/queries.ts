import { createOrgScopedClient } from './client'
import type { Organization, OrgMember } from './types'

/**
 * Typed query helpers. Components never call .from() themselves
 * (CLAUDE.md code rule 7); they call these. Every helper runs on the
 * org scoped client, so RLS has already filtered rows before any code
 * here sees them. The .eq() filters are defense in depth and better
 * query plans, not the isolation mechanism.
 */

/** The active organization's row, or null if the webhook has not synced it yet. */
export async function getActiveOrganization(): Promise<Organization | null> {
  const { client, orgId } = await createOrgScopedClient()
  const { data, error } = await client
    .from('organizations')
    .select()
    .eq('clerk_org_id', orgId)
    .maybeSingle()
  if (error) throw error
  return data
}

/** Members of the active organization. */
export async function listOrgMembers(): Promise<OrgMember[]> {
  const { client } = await createOrgScopedClient()
  const { data, error } = await client
    .from('org_members')
    .select()
    .order('created_at', { ascending: true })
  if (error) throw error
  return data
}
