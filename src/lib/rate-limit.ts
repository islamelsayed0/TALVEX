/**
 * A sliding window rate limiter, shared by every surface that needs one.
 *
 * Lifted from the chat limiter (Task 5) when a second and third caller
 * appeared, keeping its one non obvious rule: a BLOCKED attempt is not
 * counted. Counting blocked attempts lets a caller hammering the endpoint push
 * its own window forward forever and never recover, which turns a rate limit
 * into a permanent ban for anyone who trips it once.
 *
 * The honest limitation, inherited verbatim and worth repeating at every call
 * site: this is an in memory Map. On Vercel that means PER SERVER INSTANCE, so
 * the effective ceiling across warm instances is a multiple of `max`, and a
 * cold start resets the window entirely. It stops a runaway loop and a lazy
 * scanner. It is not metering and it does not stop a distributed attack.
 *
 * Making it durable means shared state, which means a Redis dependency and a
 * network round trip on requests that currently touch nothing. For a product
 * with no customers that trade is not worth making, so the limitation is
 * written down rather than papered over. The trigger to revisit is the first
 * paying customer or the first observed abuse, whichever comes first.
 */

export type RateLimitConfig = { max: number; windowMs: number }

export type RateDecision = {
  allowed: boolean
  /** Remaining attempts in the current window after this call was counted. */
  remaining: number
  /** When blocked, roughly how long until an attempt frees up. */
  retryAfterMs: number
}

export type SlidingWindow = {
  /** Count one attempt for `key` and decide whether it is allowed. */
  check: (key: string, now?: number) => RateDecision
  /** Test seam: clear every window. */
  reset: () => void
}

/**
 * Builds an independent limiter. Each call owns its own bucket map, so two
 * limiters never share state even when a caller passes the same key to both.
 */
export function createSlidingWindow(config: RateLimitConfig): SlidingWindow {
  const buckets = new Map<string, number[]>()

  return {
    check(key: string, now: number = Date.now()): RateDecision {
      const cutoff = now - config.windowMs
      const recent = (buckets.get(key) ?? []).filter((t) => t > cutoff)

      if (recent.length >= config.max) {
        // Write back the pruned list but do NOT append: the attempt is
        // refused, so it must not extend the window it just hit.
        buckets.set(key, recent)
        return {
          allowed: false,
          remaining: 0,
          retryAfterMs: Math.max(0, recent[0] + config.windowMs - now),
        }
      }

      recent.push(now)
      buckets.set(key, recent)
      return { allowed: true, remaining: config.max - recent.length, retryAfterMs: 0 }
    },

    reset(): void {
      buckets.clear()
    },
  }
}

/**
 * The caller's IP as Vercel presents it, or a fixed token when there is none.
 *
 * Everything without a forwarded address shares one bucket on purpose. The
 * alternative, treating unknown as unlimited, means the limit is bypassed by
 * whatever strips the header, and these limits guard public routes where that
 * is exactly the traffic worth slowing.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    // First entry is the original client; the rest are proxies.
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  return headers.get('x-real-ip')?.trim() || 'unknown'
}
