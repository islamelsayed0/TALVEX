import { createOrgScopedClient } from './client'
import { TagValidationError, validatedTags } from './tags'
import type { OrgMember } from './types'

/**
 * Typed data layer for member tags (BRD F14, CLAUDE.md code rule 7): the
 * admin side of audience targeting. Reads ride the membership visibility
 * migration 001 established (members of an org see its membership); the one
 * write goes through the narrow column path migration 014 added, which
 * reaches org_members.tags and nothing else. Role, identity, and membership
 * itself remain webhook written; this module cannot touch them because
 * authenticated holds no grant on those columns.
 */

/**
 * The org's members with their tags, admins first then by join date, for
 * the Members settings tab. RLS scopes this to the active org.
 */
export async function listMembersWithTags(): Promise<OrgMember[]> {
  const { client } = await createOrgScopedClient()
  const { data, error } = await client
    .from('org_members')
    .select()
    .order('created_at', { ascending: true })
  if (error) throw error
  const rank = (m: OrgMember) => (m.role === 'owner' || m.role === 'admin' ? 0 : 1)
  return data.sort((a, b) => rank(a) - rank(b))
}

/**
 * Replace one member's tags. Normalization and bounds run here; RLS makes
 * the write admin only (a non admin is refused loudly at the database, not
 * by this code) and org scoped (another org's member is out of reach). The
 * audit trigger records the change with the target and the tag names.
 */
export async function updateMemberTags(
  clerkUserId: string,
  rawTags: string[],
): Promise<OrgMember | null> {
  const tags = validatedTags(rawTags)
  const { client } = await createOrgScopedClient()
  const { data, error } = await client
    .from('org_members')
    .update({ tags })
    .eq('clerk_user_id', clerkUserId)
    .select()
    .maybeSingle()
  if (error) {
    // 42501 is the with check refusal: a session whose org_members.role is
    // not admin grade tried to write tags. The UI never offers this, so a
    // friendly message is enough; the database already said no.
    if (error.code === '42501') {
      throw new TagValidationError('Only org admins can change member tags.')
    }
    throw error
  }
  return data
}
