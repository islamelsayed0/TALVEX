import { afterEach, describe, expect, it, vi } from 'vitest'

import { isAuthorizedCronRequest } from '@/lib/monitoring/cron-auth'
import { GET } from '@/app/api/cron/check-monitors/route'

// The cron sweep's front door (Phase 1 Task 1 architecture ruling): the
// route must reject any request that does not carry the CRON_SECRET bearer
// token, before touching the database. This lives in tests/isolation/
// because it guards the same boundary the RLS suite does: the route runs on
// the service role, so its bearer check is the ONLY thing between the
// public internet and an RLS bypassing client. CLAUDE.md rule 8 applies.
//
// The authorized happy path is deliberately not exercised here: it would
// run real network checks. Rejection is what needs proving, and rejection
// happens before any client is created, so no stack or env is required.

const url = 'http://localhost/api/cron/check-monitors'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('isAuthorizedCronRequest', () => {
  it('accepts exactly the configured bearer token', () => {
    const request = new Request(url, {
      headers: { authorization: 'Bearer s3cret-value' },
    })
    expect(isAuthorizedCronRequest(request, 's3cret-value')).toBe(true)
  })

  it('rejects a missing header, wrong scheme, and wrong token', () => {
    expect(isAuthorizedCronRequest(new Request(url), 's3cret-value')).toBe(false)
    expect(
      isAuthorizedCronRequest(
        new Request(url, { headers: { authorization: 'Basic s3cret-value' } }),
        's3cret-value',
      ),
    ).toBe(false)
    expect(
      isAuthorizedCronRequest(
        new Request(url, { headers: { authorization: 'Bearer wrong' } }),
        's3cret-value',
      ),
    ).toBe(false)
    // Prefix of the real secret: catches naive startsWith comparisons.
    expect(
      isAuthorizedCronRequest(
        new Request(url, { headers: { authorization: 'Bearer s3cret' } }),
        's3cret-value',
      ),
    ).toBe(false)
  })

  it('fails closed when no secret is configured', () => {
    const request = new Request(url, {
      headers: { authorization: 'Bearer anything' },
    })
    expect(isAuthorizedCronRequest(request, undefined)).toBe(false)
    expect(isAuthorizedCronRequest(request, '')).toBe(false)
  })
})

describe('GET /api/cron/check-monitors', () => {
  it('returns 401 for a request without the secret', async () => {
    vi.stubEnv('CRON_SECRET', 'the-real-secret')
    const response = await GET(new Request(url))
    expect(response.status).toBe(401)
  })

  it('returns 401 for a request with the wrong secret', async () => {
    vi.stubEnv('CRON_SECRET', 'the-real-secret')
    const response = await GET(
      new Request(url, { headers: { authorization: 'Bearer not-it' } }),
    )
    expect(response.status).toBe(401)
  })

  it('returns 401 when CRON_SECRET is not configured, even with a token', async () => {
    vi.stubEnv('CRON_SECRET', '')
    const response = await GET(
      new Request(url, { headers: { authorization: 'Bearer anything' } }),
    )
    expect(response.status).toBe(401)
  })
})
