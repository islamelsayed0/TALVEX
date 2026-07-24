import 'server-only'

import { createClient } from '@supabase/supabase-js'

import type { Database } from './types'

/**
 * Service role client. BYPASSES ROW LEVEL SECURITY ENTIRELY.
 *
 * Permitted callers, exhaustively:
 *   - src/app/api/webhooks/clerk/route.ts  (syncing Clerk orgs and members;
 *     webhooks carry no user session, so there is no token to scope by)
 *   - src/app/api/cron/check-monitors/route.ts  (the cron sweep; cron
 *     invocations carry no user session either, and it must write check
 *     results and rollups across every org in one pass)
 *   - src/lib/chat/key-vault.ts  (reads and decrypts an org's provider key at
 *     the moment of a chat provider call; the ciphertext column is withheld
 *     from the authenticated SELECT grant, so only the service role can read
 *     it, and the plaintext lives only in that request scope, ruling 2/3)
 *   - src/lib/chat/engine.ts  (writes chat_messages; those rows are system
 *     written like monitor_checks, so authenticated has no insert verb and the
 *     server is the only writer, migration 008)
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
