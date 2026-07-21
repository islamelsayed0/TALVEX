import { auth } from '@clerk/nextjs/server'
import { createClient } from '@supabase/supabase-js'

import type { Database } from './types'

/**
 * Thrown when a query is attempted without an active organization claim.
 *
 * Architect ruling (see docs/DECISIONS.md, hidePersonal entry): the data
 * layer refuses to run any query without an org claim. Without one, every
 * RLS predicate resolves to null and matches nothing, so queries would
 * return zero rows silently and read as an empty tenant. Refusing loudly
 * here is what makes that failure impossible. The app layer's job is to
 * redirect org-less sessions to /select-org before ever calling this; this
 * error firing means a caller skipped that step.
 */
export class MissingActiveOrgError extends Error {
  constructor() {
    super(
      'No active organization on this session. The app layer must redirect ' +
        'org-less sessions to /select-org before touching the data layer.',
    )
    this.name = 'MissingActiveOrgError'
  }
}

/**
 * Request scoped Supabase client that runs every query AS THE SIGNED IN USER.
 *
 * The Clerk session token is forwarded as the Supabase access token
 * (third party auth, docs/DECISIONS.md), so RLS filters rows to the active
 * organization at the database. This is the default client; everything in
 * the app goes through it. The service role client in admin.ts is the
 * narrow exception, never the rule.
 *
 * Returns the client together with the orgId it is scoped to, so callers
 * can key caches or logs by tenant without re-deriving it.
 */
export async function createOrgScopedClient() {
  const { orgId, getToken } = await auth()

  if (!orgId) {
    throw new MissingActiveOrgError()
  }

  const client = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      accessToken: async () => (await getToken()) ?? null,
      auth: { persistSession: false },
    },
  )

  return { client, orgId }
}
