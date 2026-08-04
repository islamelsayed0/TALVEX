import { describe, expect, it } from 'vitest'

import { certExpiryFromPeer } from '@/lib/monitoring/check'

// Unit suite for the peer certificate parser. The full handshake path cannot
// run here (the SSRF guard refuses loopback and the suite must not touch the
// network), so the PR carries a manual verification step for it; what IS
// provable without a socket is that every shape getPeerCertificate can return
// comes out as a valid ISO instant or a clean null.

describe('certExpiryFromPeer', () => {
  it('parses the OpenSSL date format getPeerCertificate returns', () => {
    // Double space before the single digit day is exactly how OpenSSL
    // renders it; Date.parse accepts it.
    expect(certExpiryFromPeer({ valid_to: 'Jul  1 12:00:00 2027 GMT' })).toBe(
      '2027-07-01T12:00:00.000Z',
    )
    expect(certExpiryFromPeer({ valid_to: 'Dec 31 23:59:59 2026 GMT' })).toBe(
      '2026-12-31T23:59:59.000Z',
    )
  })

  it('is null for a missing or empty certificate', () => {
    expect(certExpiryFromPeer(null)).toBeNull()
    expect(certExpiryFromPeer(undefined)).toBeNull()
    // getPeerCertificate() returns {} when no certificate was presented.
    expect(certExpiryFromPeer({})).toBeNull()
  })

  it('is null for anything unparseable, never a crash', () => {
    expect(certExpiryFromPeer({ valid_to: 'not a date' })).toBeNull()
    expect(certExpiryFromPeer({ valid_to: '' })).toBeNull()
    expect(certExpiryFromPeer({ valid_to: 12345 })).toBeNull()
    expect(certExpiryFromPeer({ valid_to: null })).toBeNull()
  })
})
