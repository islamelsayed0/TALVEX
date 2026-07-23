import 'server-only'

import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

import { isForbiddenHostname, isPrivateIp } from '@/lib/db/monitor-url'

/**
 * The actual HTTP check, deliberately minimal for Phase 1 (architecture
 * ruling): GET the URL, 2xx within 10 seconds means up, anything else means
 * down. Record elapsed milliseconds whenever an HTTP response arrived. No
 * keyword matching, no cert inspection, no regions; those are Phase 2.
 *
 * SSRF guard: monitor URLs are USER SUPPLIED and fetched from OUR
 * infrastructure, so before every request (including every redirect hop) the
 * target hostname is resolved and every address it resolves to must be
 * public. Private, loopback, link local, and CGNAT space is refused; see
 * isPrivateIp in src/lib/db/monitor-url.ts for the exact ranges. This runs
 * at check time, not save time, because DNS answers change after save.
 *
 * Accepted residual risk, noted on purpose: the guard resolves the name and
 * then fetch() resolves it again, so a DNS rebinding attacker flipping
 * records between the two lookups could still reach an internal address.
 * Closing that fully means pinning the connection to the vetted IP, which
 * fights TLS SNI and Host handling; revisit in Phase 2 alongside the other
 * check hardening. The guard as written stops every static private URL and
 * ordinary DNS tricks.
 */

const CHECK_TIMEOUT_MS = 10_000
const MAX_REDIRECTS = 5
const MAX_ERROR_LENGTH = 300

export type CheckOutcome = {
  status: 'up' | 'down'
  responseTimeMs: number | null
  errorMessage: string | null
}

/** Thrown when the SSRF guard refuses a hostname. */
class BlockedTargetError extends Error {}

async function assertPublicTarget(hostname: string): Promise<void> {
  // URL.hostname keeps brackets on IPv6 literals.
  const bare = hostname.replace(/^\[|\]$/g, '')

  if (isForbiddenHostname(bare) || (isIP(bare) !== 0 && isPrivateIp(bare))) {
    throw new BlockedTargetError(
      'Blocked: this host points at private or internal address space.',
    )
  }
  if (isIP(bare) !== 0) return

  const addresses = await lookup(bare, { all: true, verbatim: true })
  if (addresses.some((a) => isPrivateIp(a.address))) {
    throw new BlockedTargetError(
      'Blocked: this host resolves to private or internal address space.',
    )
  }
}

function truncate(message: string): string {
  return message.length > MAX_ERROR_LENGTH
    ? `${message.slice(0, MAX_ERROR_LENGTH - 1)}…`
    : message
}

function down(responseTimeMs: number | null, errorMessage: string): CheckOutcome {
  return { status: 'down', responseTimeMs, errorMessage: truncate(errorMessage) }
}

/** Runs one guarded check. Never throws; every failure is a down outcome. */
export async function runMonitorCheck(rawUrl: string): Promise<CheckOutcome> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return down(null, 'The stored URL could not be parsed.')
  }

  const started = performance.now()
  const elapsed = () => Math.round(performance.now() - started)
  // One deadline for the whole check, redirects included.
  const signal = AbortSignal.timeout(CHECK_TIMEOUT_MS)

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return down(null, `Refused to follow a redirect to ${url.protocol} URL.`)
      }
      await assertPublicTarget(url.hostname)

      const response = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal,
        headers: { 'user-agent': 'TalvexMonitor/1.0' },
      })
      // Headers are enough to judge the check; drop the body.
      await response.body?.cancel()

      const location = response.headers.get('location')
      if (response.status >= 300 && response.status < 400 && location) {
        // Each hop goes back through the SSRF guard at the top of the loop.
        url = new URL(location, url)
        continue
      }

      if (response.ok) {
        return { status: 'up', responseTimeMs: elapsed(), errorMessage: null }
      }
      return down(elapsed(), `HTTP ${response.status}`)
    }
    return down(elapsed(), `Gave up after ${MAX_REDIRECTS} redirects.`)
  } catch (err) {
    if (err instanceof BlockedTargetError) {
      return down(null, err.message)
    }
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      return down(null, `No response within ${CHECK_TIMEOUT_MS / 1000} seconds.`)
    }
    // undici wraps network errors; the cause code (ENOTFOUND, ECONNREFUSED,
    // certificate errors) is the useful part. Never echo tenant data here
    // beyond what the error itself carries.
    const cause =
      err instanceof Error && err.cause instanceof Error
        ? ((err.cause as NodeJS.ErrnoException).code ?? err.cause.message)
        : err instanceof Error
          ? err.message
          : 'unknown error'
    return down(null, `Connection failed: ${cause}`)
  }
}
