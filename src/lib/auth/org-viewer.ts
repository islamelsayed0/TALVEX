import 'server-only'

import { auth } from '@clerk/nextjs/server'

import { createOrgScopedClient } from '@/lib/db/client'

/**
 * Who is looking, per the database. The Clerk user id identifies the session;
 * isAdmin comes from org_members.role for the active org, the same column RLS
 * reads, never the token's role claim. A forged or stale claim changes
 * nothing here because this asks the table.
 *
 * This is a UI affordance only: it decides what to render (an admin only
 * button, an admin only column). RLS enforces the same answer on every query
 * regardless of what this returns, so a wrong answer here can hide or show a
 * control but can never widen or narrow what the database actually allows.
 */
export type OrgViewer = {
  userId: string
  isAdmin: boolean
}

export async function getActiveOrgViewer(): Promise<OrgViewer> {
  const { client } = await createOrgScopedClient()
  const { userId } = await auth()
  if (!userId) {
    // Unreachable behind Clerk middleware; kept as a loud failure rather than
    // a silent non-admin default.
    throw new Error('No signed in user on this session.')
  }
  const { data, error } = await client
    .from('org_members')
    .select('role')
    .eq('clerk_user_id', userId)
    .maybeSingle()
  if (error) throw error
  return {
    userId,
    isAdmin: data?.role === 'admin' || data?.role === 'owner',
  }
}
