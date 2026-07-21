import 'server-only'

import { createClient } from '@supabase/supabase-js'

import type { Database } from './types'

/**
 * Service role client. BYPASSES ROW LEVEL SECURITY ENTIRELY.
 *
 * Permitted callers, exhaustively:
 *   - src/app/api/webhooks/clerk/route.ts  (syncing Clerk orgs and members;
 *     webhooks carry no user session, so there is no token to scope by)
 *   - future cron route handlers and migration tooling, added to this list
 *     when they exist
 *
 * Never import this from a component, a page, or anything reachable from
 * one. Every use outside this list is a tenant isolation bug by definition.
 * The 'server-only' import makes any client bundle inclusion a build error,
 * and SUPABASE_SERVICE_ROLE_KEY has no NEXT_PUBLIC_ prefix so the key
 * cannot reach the browser (CLAUDE.md security rules 1 and 4).
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. It lives in .env.local and in ' +
        'Vercel env vars, never in the repo. See .env.example.',
    )
  }

  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false },
  })
}
