import 'server-only'

import { lookup } from 'node:dns/promises'
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import type { TLSSocket } from 'node:tls'

import { isForbiddenHostname, isPrivateIp } from '@/lib/db/monitor-url'

/**
 * The actual HTTP check, deliberately minimal (architecture ruling): GET the
 * URL, 2xx within 10 seconds means up, anything else means down. Record
 * elapsed milliseconds whenever an HTTP response arrived. No keyword
 * matching, no regions.
 *
 * Transport: node:https / node:http requests, not fetch. fetch's Response
 * deliberately never exposes the peer socket, and the certificate expiry
 * feature reads the TLS certificate from the handshake this check already
 * performs (zero extra connections). node's request hands over the socket,
 * so the one handshake serves both the check and the expiry read. Behavior
 * is otherwise identical to the previous fetch transport: manual redirects,
 * one shared deadline, body dropped after headers.
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
  /**
   * Expiry instant of the monitored host's TLS certificate, read from the
   * first hop's handshake. NULL for http monitors and whenever the read
   * failed; a failed read never fails the check.
   */
  certExpiresAt: string | null
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

function down(
  responseTimeMs: number | null,
  errorMessage: string,
  certExpiresAt: string | null = null,
): CheckOutcome {
  return {
    status: 'down',
    responseTimeMs,
    errorMessage: truncate(errorMessage),
    certExpiresAt,
  }
}

/**
 * Parses the expiry out of a peer certificate object as an ISO instant.
 * getPeerCertificate() returns {} when no certificate is available, and
 * valid_to is an OpenSSL date string ("Jul  1 12:00:00 2027 GMT"); anything
 * unparseable yields null. Exported for its unit tests.
 */
export function certExpiryFromPeer(
  cert: { valid_to?: unknown } | null | undefined,
): string | null {
  if (!cert || typeof cert.valid_to !== 'string') return null
  const parsed = new Date(cert.valid_to)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

/**
 * One GET over node:https / node:http. Resolves once response headers are in
 * (the body is dropped, as before), carrying the peer certificate expiry
 * when asked for. agent: false gives every check a dedicated connection, so
 * the handshake the expiry is read from is this check's own, never a pooled
 * socket from an earlier one.
 */
function requestOnce(
  url: URL,
  signal: AbortSignal,
  wantCert: boolean,
): Promise<{
  statusCode: number
  location: string | null
  certExpiresAt: string | null
}> {
  return new Promise((resolve, reject) => {
    const request = url.protocol === 'https:' ? httpsRequest : httpRequest
    const req = request(url, {
      method: 'GET',
      signal,
      agent: false,
      headers: { 'user-agent': 'TalvextMonitor/1.0' },
    })
    req.on('response', (res: IncomingMessage) => {
      let certExpiresAt: string | null = null
      if (wantCert && url.protocol === 'https:') {
        try {
          const socket = res.socket as TLSSocket
          certExpiresAt = certExpiryFromPeer(
            typeof socket.getPeerCertificate === 'function'
              ? socket.getPeerCertificate()
              : null,
          )
        } catch {
          certExpiresAt = null
        }
      }
      const statusCode = res.statusCode ?? 0
      const location = res.headers.location ?? null
      // Headers are enough to judge the check; drop the body and the socket.
      res.destroy()
      resolve({ statusCode, location, certExpiresAt })
    })
    req.on('error', reject)
    req.end()
  })
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

  // The certificate recorded is the ORIGINAL monitor URL host's, from the
  // first hop: that is the host the user asked Talvext to watch, and the one
  // whose expiry takes their site down. Redirect targets are often hosts the
  // org does not own; alerting on those would be noise.
  let certExpiresAt: string | null = null

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return down(
          null,
          `Refused to follow a redirect to ${url.protocol} URL.`,
          certExpiresAt,
        )
      }
      await assertPublicTarget(url.hostname)

      const response = await requestOnce(url, signal, hop === 0)
      if (hop === 0) certExpiresAt = response.certExpiresAt

      if (
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.location
      ) {
        // Each hop goes back through the SSRF guard at the top of the loop.
        url = new URL(response.location, url)
        continue
      }

      if (response.statusCode >= 200 && response.statusCode < 300) {
        return {
          status: 'up',
          responseTimeMs: elapsed(),
          errorMessage: null,
          certExpiresAt,
        }
      }
      return down(elapsed(), `HTTP ${response.statusCode}`, certExpiresAt)
    }
    return down(elapsed(), `Gave up after ${MAX_REDIRECTS} redirects.`, certExpiresAt)
  } catch (err) {
    if (err instanceof BlockedTargetError) {
      return down(null, err.message, certExpiresAt)
    }
    if (
      signal.aborted ||
      (err instanceof DOMException && err.name === 'TimeoutError')
    ) {
      return down(
        null,
        `No response within ${CHECK_TIMEOUT_MS / 1000} seconds.`,
        certExpiresAt,
      )
    }
    // node's request errors carry the code directly (ENOTFOUND, ECONNREFUSED,
    // CERT_HAS_EXPIRED); wrapped errors keep it on the cause. Never echo
    // tenant data here beyond what the error itself carries.
    const code = (err as NodeJS.ErrnoException | null)?.code
    const cause =
      typeof code === 'string'
        ? code
        : err instanceof Error && err.cause instanceof Error
          ? ((err.cause as NodeJS.ErrnoException).code ?? err.cause.message)
          : err instanceof Error
            ? err.message
            : 'unknown error'
    return down(null, `Connection failed: ${cause}`, certExpiresAt)
  }
}
