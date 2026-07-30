import 'server-only'

import { sweepFreshness, type SweepFreshness } from '@/lib/monitoring/heartbeat'

import { createAnonClient, createOrgScopedClient } from './client'

/**
 * Reads of the sweep heartbeat (migration 018, CLAUDE.md rule 7).
 *
 * The table is platform state, not org data: one row, no org_id, readable by
 * any signed in session under a deliberate `using (true)` policy. It is still
 * read through the org scoped client rather than the service role, because
 * nothing here needs to bypass RLS and a dashboard read has no business
 * holding a client that could.
 *
 * Writes are not here and never will be. Only the cron sweep stamps this row,
 * with the service role, and no user session holds an update grant on it.
 */

/**
 * Freshness of the last sweep, as the dashboard should present it. Returns
 * `never` when the read fails as well as when the row has no timestamp: a
 * heartbeat we cannot read is not evidence that monitoring is running, and the
 * whole point of this table is refusing to imply health we cannot demonstrate.
 */
export async function readSweepHeartbeat(nowMs: number = Date.now()): Promise<SweepFreshness> {
  const { client } = await createOrgScopedClient()
  const { data, error } = await client
    .from('platform_heartbeat')
    .select('last_run_at')
    .eq('id', 'sweep')
    .maybeSingle()
  if (error || !data) return { state: 'never' }
  return sweepFreshness(data.last_run_at, nowMs)
}

/**
 * The same freshness, read with no session, for the public endpoint the
 * external watcher polls. That watcher has to work when nobody is signed in
 * and, more to the point, when the deployment is in trouble, so it cannot
 * depend on Clerk.
 *
 * Uses the anon client rather than the service role deliberately: an
 * unauthenticated public route must never hold a client that bypasses RLS.
 * anon is granted only id, last_run_at, and last_success_at on this table
 * (migration 018), so the operational counts are unreachable from here by
 * grant, not merely by this function choosing not to select them.
 */
export async function readPublicSweepFreshness(
  nowMs: number = Date.now(),
): Promise<SweepFreshness> {
  const { data, error } = await createAnonClient()
    .from('platform_heartbeat')
    .select('last_run_at')
    .eq('id', 'sweep')
    .maybeSingle()
  if (error || !data) return { state: 'never' }
  return sweepFreshness(data.last_run_at, nowMs)
}
