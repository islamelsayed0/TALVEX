import 'server-only'

import { createAdminClient } from '@/lib/db/admin'
import { currentAndPreviousMonth, DEFAULT_TIMEZONE } from '@/lib/db/usage'
import type { AiProvider } from '@/lib/db/types'
import { logError } from '@/lib/log'
import { getEntitlements } from './entitlements'

/**
 * Managed AI: the platform key path (F13 PR 3, the audit M4 ceiling landing
 * as an entitlement). BYOK is untouched by everything in this module: an org
 * key always wins, is never metered, and never consults the allowance. This
 * path exists only for orgs with NO key of their own whose plan includes
 * managed answers.
 *
 * The meter is the database, not memory (the rate limiter's stated
 * limitation): used answers are a count of chat_messages rows with
 * key_source = 'platform' in the org's current month, bucketed by the org's
 * one authoritative timezone exactly as the F11 usage screen buckets. The
 * answer is metered by the row that IS the answer, so the counter cannot
 * drift from the transcript and cannot be written by any user session
 * (migration 008: no user verbs on chat_messages).
 *
 * Two requests racing at the last included answer can both pass and write
 * 301: the overage is ours to absorb, never charged, never a lockout of a
 * reply already promised. The recorded anti patterns (silent failure,
 * automatic upgrade, overage charges) are the constraint; a one answer
 * overshoot violates none of them.
 */

/** The managed path runs on one provider, ours. BYOK keeps its three. */
export const MANAGED_PROVIDER: AiProvider = 'anthropic'

/** The platform key, server only, test account until the live gates pass.
 * Absent means the managed path is switched off operationally. */
export function platformApiKey(): string | null {
  const key = process.env.PLATFORM_ANTHROPIC_API_KEY
  return key && key.trim() ? key : null
}

/** Logged once per process, the notifications email pattern: the layout
 * resolves access on every dashboard render, and a line per render is a
 * muted channel by lunchtime. */
let missingPlatformKeyLogged = false

export type ManagedAccess =
  /** Managed answers may be served right now. */
  | { mode: 'available'; included: number; used: number; remaining: number }
  /** The month's allowance is spent: degrade to the Get Help door. */
  | { mode: 'capped'; included: number }
  /** The org IS entitled but the platform side cannot serve (no key
   * configured). The same honest degrade as the cap, because to the person
   * asking, the truth is identical: no answer now, the ticket door works,
   * nothing is charged. Distinct from 'none' so an org that paid for
   * managed answers is never shown the free tier's ask an admin copy. */
  | { mode: 'unavailable' }
  /** No managed entitlement. */
  | { mode: 'none' }

type Db = ReturnType<typeof createAdminClient>

/** Platform answered messages in the org's current month. */
export async function managedAnswersUsed(
  db: Db,
  orgUuid: string,
  timezone: string,
  nowMs: number,
): Promise<number> {
  const { current } = currentAndPreviousMonth(nowMs, timezone)
  const { count, error } = await db
    .from('chat_messages')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgUuid)
    .eq('role', 'assistant')
    .eq('key_source', 'platform')
    .gte('created_at', new Date(current.startMs).toISOString())
    .lt('created_at', new Date(current.endMs).toISOString())
  if (error) throw error
  return count ?? 0
}

/**
 * Whether the org may have a managed answer served right now. Callers that
 * already know the org has a BYOK key must not call this; BYOK wins first.
 */
export async function resolveManagedAccess(
  clerkOrgId: string,
  now: Date = new Date(),
): Promise<ManagedAccess> {
  const entitlements = await getEntitlements(clerkOrgId)
  if (entitlements.aiAnswersIncluded <= 0) return { mode: 'none' }

  if (!platformApiKey()) {
    // An org paid for managed answers the operator has not configured a key
    // for. That is a platform failure worth a line, not a user error.
    if (!missingPlatformKeyLogged) {
      missingPlatformKeyLogged = true
      logError('chat.platform_key.not_configured', 'unavailable')
    }
    return { mode: 'unavailable' }
  }

  const db = createAdminClient()
  const { data: org, error } = await db
    .from('organizations')
    .select('id, timezone')
    .eq('clerk_org_id', clerkOrgId)
    .maybeSingle()
  if (error) throw error
  if (!org) return { mode: 'none' }

  const used = await managedAnswersUsed(
    db,
    org.id,
    org.timezone ?? DEFAULT_TIMEZONE,
    now.getTime(),
  )
  const included = entitlements.aiAnswersIncluded
  if (used >= included) return { mode: 'capped', included }
  return { mode: 'available', included, used, remaining: included - used }
}

/**
 * What the chat surfaces should offer this org, in one question. byok and
 * managed both mean the ask entry is open; capped means the recorded degrade
 * (the Get Help ticket door with plain copy); unavailable is the same door
 * with the platform down copy (entitled, but the platform side cannot serve
 * right now); none means the original BYOK era behavior (ask an admin for a
 * key, or upgrade).
 */
export type ChatEntryMode = 'byok' | 'managed' | 'capped' | 'unavailable' | 'none'

export async function chatEntryMode(
  clerkOrgId: string,
  orgHasByokKey: boolean,
): Promise<ChatEntryMode> {
  if (orgHasByokKey) return 'byok'
  const access = await resolveManagedAccess(clerkOrgId)
  if (access.mode === 'available') return 'managed'
  if (access.mode === 'capped') return 'capped'
  if (access.mode === 'unavailable') return 'unavailable'
  return 'none'
}
