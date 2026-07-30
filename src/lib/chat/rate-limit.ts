import { createSlidingWindow, type RateDecision } from '@/lib/rate-limit'

/**
 * Application layer rate limit for chat sends (Task 5): generous but present,
 * to protect the customer's key from a runaway loop or an abusive member of
 * their own org. Thirty messages per minute per user per org.
 *
 * The window itself now lives in src/lib/rate-limit.ts, shared with the public
 * routes that were added later. The limitation stated here from the start is
 * unchanged and belongs to the shared module too: this is in memory, so on
 * Vercel it is per server instance and the effective ceiling across warm
 * instances is a multiple of the limit. Acceptable for the stated goal, which
 * is stopping a loop rather than metering usage; real per tenant metering
 * arrives with BRD F11.
 */

export const CHAT_RATE_LIMIT = { max: 30, windowMs: 60_000 } as const

export type { RateDecision }

const window = createSlidingWindow(CHAT_RATE_LIMIT)

/**
 * Count one send attempt for (orgId, userId) and decide whether it is allowed.
 * `now` is injectable so the test drives the clock deterministically. A blocked
 * attempt is NOT counted, so a caller hammering the endpoint cannot push its
 * own window forward forever.
 */
export function checkChatRateLimit(
  orgId: string,
  userId: string,
  now: number = Date.now(),
): RateDecision {
  return window.check(`${orgId}:${userId}`, now)
}

/** Test seam: clear all windows between cases. */
export function resetChatRateLimit(): void {
  window.reset()
}
