/**
 * Monitor URL validation. Two layers, and it matters which runs where:
 *
 * 1. validateMonitorUrl (here, at the data layer): syntactic. http or https
 *    only, a real hostname, sane length. Runs on every create and update.
 *
 * 2. Address space screening (isPrivateIp / isForbiddenHostname, consumed by
 *    src/lib/monitoring/check.ts): the SSRF guard. Monitor checks fetch USER
 *    SUPPLIED URLs from OUR infrastructure, so a URL whose host resolves to
 *    private or internal address space (localhost, RFC 1918, link local,
 *    loopback, CGNAT) must never be fetched: it would let a tenant probe the
 *    platform's own network. The guard runs at CHECK time, against the DNS
 *    answer actually being used, because a hostname's records can change
 *    after save; validating the address only at create time would be a
 *    time of check / time of use hole.
 *
 * This module is pure (no DNS, no network) so it is unit testable and safe
 * to call anywhere server side.
 */

export type UrlValidation =
  | { ok: true; url: string }
  | { ok: false; reason: string }

/** Syntactic validation for a monitor URL. Returns the normalized href. */
export function validateMonitorUrl(raw: string): UrlValidation {
  const trimmed = raw.trim()
  if (trimmed === '') {
    return { ok: false, reason: 'Enter a URL to check.' }
  }
  if (trimmed.length > 2048) {
    return { ok: false, reason: 'That URL is too long.' }
  }

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return { ok: false, reason: 'That does not look like a valid URL.' }
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'Only http and https URLs can be monitored.' }
  }
  if (url.hostname === '') {
    return { ok: false, reason: 'That URL is missing a host.' }
  }
  // Credentials in monitor URLs would end up stored in plain text and sent
  // on every check; refuse them outright.
  if (url.username !== '' || url.password !== '') {
    return { ok: false, reason: 'URLs with embedded credentials are not supported.' }
  }

  return { ok: true, url: url.href }
}

/** Hostnames that are internal by definition, before any DNS is consulted. */
export function isForbiddenHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  return host === 'localhost' || host.endsWith('.localhost')
}

/**
 * True when an IP literal (as returned by DNS lookup or found in a URL)
 * belongs to private, loopback, link local, or otherwise internal address
 * space that monitor checks must never touch.
 */
export function isPrivateIp(address: string): boolean {
  const v4 = parseIpv4(address)
  if (v4) return isPrivateIpv4(v4)
  return isPrivateIpv6(address)
}

function parseIpv4(address: string): number[] | null {
  const m = address.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return null
  const octets = m.slice(1).map(Number)
  return octets.every((o) => o <= 255) ? octets : null
}

function isPrivateIpv4([a, b]: number[]): boolean {
  if (a === 0) return true // 0.0.0.0/8, "this network"
  if (a === 10) return true // RFC 1918
  if (a === 127) return true // loopback
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64/10 CGNAT
  if (a === 169 && b === 254) return true // link local
  if (a === 172 && b >= 16 && b <= 31) return true // RFC 1918
  if (a === 192 && b === 168) return true // RFC 1918
  return false
}

function isPrivateIpv6(address: string): boolean {
  const host = address.toLowerCase().split('%')[0] // strip zone id
  if (host === '::' || host === '::1') return true // unspecified, loopback

  // IPv4 mapped or compatible (::ffff:10.0.0.1 and friends): judge by the
  // embedded IPv4.
  const embedded = host.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
  if (embedded) {
    const v4 = parseIpv4(embedded[1])
    if (v4) return isPrivateIpv4(v4)
  }

  const firstGroup = host.split(':').find((g) => g !== '')
  if (!firstGroup) return true
  const value = parseInt(firstGroup, 16)
  if (Number.isNaN(value)) return true // unparseable: fail closed
  if ((value & 0xfe00) === 0xfc00) return true // fc00::/7 unique local
  if ((value & 0xffc0) === 0xfe80) return true // fe80::/10 link local
  if ((value & 0xffc0) === 0xfec0) return true // fec0::/10 site local (deprecated, still internal)
  return false
}
