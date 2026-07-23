import 'server-only'

import { clerkClient } from '@clerk/nextjs/server'

/**
 * Display names for Clerk user ids, for the tickets screens: submitters,
 * comment authors, and trail actors are stored as Clerk user ids (the same
 * ids RLS pins), and only the UI needs the human name behind one. Resolved
 * server side through the Clerk backend API; nothing is stored.
 *
 * Best effort by design: a Clerk hiccup degrades to the fallback label
 * instead of failing the page, because a name is decoration here, never
 * authorization.
 */

export const UNKNOWN_MEMBER = 'A member'

export async function resolveUserNames(
  userIds: Array<string | null>,
): Promise<Map<string, string>> {
  const unique = [...new Set(userIds.filter((id): id is string => !!id))]
  const names = new Map<string, string>()
  if (unique.length === 0) return names

  try {
    const clerk = await clerkClient()
    const { data } = await clerk.users.getUserList({
      userId: unique,
      limit: unique.length,
    })
    for (const user of data) {
      const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ')
      names.set(
        user.id,
        fullName ||
          user.emailAddresses[0]?.emailAddress ||
          UNKNOWN_MEMBER,
      )
    }
  } catch {
    // Fall through: callers render UNKNOWN_MEMBER for anything unresolved.
  }
  return names
}
