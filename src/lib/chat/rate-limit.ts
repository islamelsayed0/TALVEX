/**
 * Application layer rate limit for chat sends (Task 5): generous but present,
 * to protect the customer's key from a runaway loop or an abusive member of
 * their own org. Thirty messages per minute per user per org.
 *
 * A sliding window over an in memory map. Honest limitation: on Vercel this is
 * PER SERVER INSTANCE, so the effective ceiling across many warm instances is a
 * multiple of the limit. That is acceptable for the stated goal (stop a loop,
 * not meter usage); real per tenant metering arrives with BRD F11. Stated in
 * the PR. The window and max are exported so the test pins the exact numbers.
 */

export const CHAT_RATE_LIMIT = { max: 30, windowMs: 60_000 } as const

export type RateDecision = {
  allowed: boolean
  /** Remaining sends in the current window after this call was counted. */
  remaining: number
  /** When blocked, roughly how long until a send frees up. */
  retryAfterMs: number
}

const buckets = new Map<string, number[]>()

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
  const key = `${orgId}:${userId}`
  const cutoff = now - CHAT_RATE_LIMIT.windowMs
  const recent = (buckets.get(key) ?? []).filter((t) => t > cutoff)

  if (recent.length >= CHAT_RATE_LIMIT.max) {
    buckets.set(key, recent)
    const retryAfterMs = recent[0] + CHAT_RATE_LIMIT.windowMs - now
    return { allowed: false, remaining: 0, retryAfterMs: Math.max(0, retryAfterMs) }
  }

  recent.push(now)
  buckets.set(key, recent)
  return {
    allowed: true,
    remaining: CHAT_RATE_LIMIT.max - recent.length,
    retryAfterMs: 0,
  }
}

/** Test seam: clear all windows between cases. */
export function resetChatRateLimit(): void {
  buckets.clear()
}
