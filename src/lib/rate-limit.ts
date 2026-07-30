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
/**
 * How many distinct keys one window will track before it prunes.
 *
 * These limiters sit on unauthenticated routes, so the set of keys is driven
 * by whoever is calling, not by how many customers exist. Without a ceiling
 * the map grows for as long as the instance lives. The bound keeps the memory
 * cost of being scanned proportional to this constant rather than to traffic.
 */
const MAX_TRACKED_KEYS = 10_000

export function createSlidingWindow(config: RateLimitConfig): SlidingWindow {
  const buckets = new Map<string, number[]>()

  /**
   * Drop keys whose windows have fully expired. They are dead weight: a key
   * with no timestamps inside the window behaves identically to one that was
   * never seen. If pruning does not get us under the ceiling, every remaining
   * key is currently active and the map is cleared, which briefly forgives
   * everyone rather than growing without bound. Forgiving is the right
   * failure direction here: the alternative is refusing legitimate callers
   * because the map is full, which turns a limiter into an outage.
   */
  function prune(cutoff: number): void {
    for (const [key, times] of buckets) {
      if (times.length === 0 || times[times.length - 1] <= cutoff) buckets.delete(key)
    }
    if (buckets.size > MAX_TRACKED_KEYS) buckets.clear()
  }

  return {
    check(key: string, now: number = Date.now()): RateDecision {
      const cutoff = now - config.windowMs
      if (buckets.size >= MAX_TRACKED_KEYS && !buckets.has(key)) prune(cutoff)
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
 * The caller's address, taken only from values the platform sets.
 *
 * The tempting implementation reads `x-forwarded-for` and takes the FIRST
 * entry, on the reasoning that the chain runs client first and proxies after.
 * That is true and it is the wrong entry to trust, because the leading entries
 * are whatever the client sent. A caller who forges a fresh
 * `x-forwarded-for` on each request lands in a fresh bucket every time, which
 * bypasses every limit built on this function completely, and fills the bucket
 * map with keys of the attacker's choosing.
 *
 * So: prefer the headers the edge sets and a client cannot forge, and when
 * falling back to the chain, take the LAST hop, which is the one appended by
 * the trusted proxy nearest to us rather than the one furthest away.
 *
 * Everything without a determinable address shares one bucket on purpose. The
 * alternative, treating unknown as unlimited, means the limit is bypassed by
 * whatever strips the header, and these limits guard public routes where that
 * is exactly the traffic worth slowing.
 */
export function clientIp(headers: Headers): string {
  // Set by the Vercel edge, not forwarded from the client.
  const vercel = headers.get('x-vercel-forwarded-for')?.trim()
  if (vercel) return vercel

  const real = headers.get('x-real-ip')?.trim()
  if (real) return real

  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    const hops = forwarded.split(',')
    const nearest = hops[hops.length - 1]?.trim()
    if (nearest) return nearest
  }
  return 'unknown'
}
