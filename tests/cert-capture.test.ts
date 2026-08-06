import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { certExpiryFromPeer, requestOnce } from '@/lib/monitoring/check'

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

// ---------------------------------------------------------------------------
// The behavior the badssl verification demanded, pinned locally: a
// certificate that FAILS verification still reports its expiry, while the
// hop itself still fails with the verification error and not one HTTP byte
// crosses the unverified channel. Driven through requestOnce directly,
// because the SSRF guard rightly refuses runMonitorCheck access to loopback.

function hasOpenssl(): boolean {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

describe.skipIf(!hasOpenssl())('requestOnce against an unverifiable local cert', () => {
  let dir: string
  let server: Server
  let port: number
  let requestsServed = 0

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'talvext-cert-'))
    execFileSync(
      'openssl',
      [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
        '-keyout', join(dir, 'key.pem'),
        '-out', join(dir, 'cert.pem'),
        '-days', '2',
        '-subj', '/CN=localhost',
      ],
      { stdio: 'ignore' },
    )
    server = createServer(
      {
        key: readFileSync(join(dir, 'key.pem')),
        cert: readFileSync(join(dir, 'cert.pem')),
      },
      (_req, res) => {
        requestsServed++
        res.end('hello')
      },
    )
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') {
      throw new Error('server did not bind a port')
    }
    port = address.port
  }, 30_000)

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(dir, { recursive: true, force: true })
  })

  it('captures the expiry, fails the hop, and writes nothing to the channel', async () => {
    const result = await requestOnce(
      new URL(`https://127.0.0.1:${port}/`),
      AbortSignal.timeout(5_000),
      true,
    )
    expect(result.ok).toBe(false)
    if (result.ok) return

    // The verification verdict is intact: a self signed certificate is
    // refused with the same code rejectUnauthorized true would produce.
    const err = result.error as NodeJS.ErrnoException
    expect(err.code ?? err.message).toBe('DEPTH_ZERO_SELF_SIGNED_CERT')

    // And yet the certificate said when it expires: about two days out.
    expect(result.certExpiresAt).not.toBeNull()
    const daysOut = (Date.parse(result.certExpiresAt!) - Date.now()) / 86_400_000
    expect(daysOut).toBeGreaterThan(1)
    expect(daysOut).toBeLessThan(3)

    // The refusal happened before any HTTP was spoken over the socket.
    expect(requestsServed).toBe(0)
  })
})
