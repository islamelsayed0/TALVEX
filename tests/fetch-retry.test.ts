import { describe, expect, it, vi } from 'vitest'

import { withClockSkewRetry } from '@/lib/db/fetch-retry'

/**
 * The PGRST303 retry contract: exactly one replay, only for the clock skew
 * rejection, everything else untouched. The failure this guards against is
 * a fresh Clerk token judged "not yet valid" by Supabase for a moment
 * around its mint second; see src/lib/db/fetch-retry.ts.
 */

const skewBody = JSON.stringify({
  code: 'PGRST303',
  details: null,
  hint: null,
  message: 'JWT not yet valid',
})

function res(status: number, body: string) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('withClockSkewRetry', () => {
  it('passes successful responses through without retrying', async () => {
    const base = vi.fn(async () => res(200, '[{"id":"a"}]'))
    const fetchWithRetry = withClockSkewRetry(base, 0)

    const response = await fetchWithRetry('https://db.example/rest/v1/x')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([{ id: 'a' }])
    expect(base).toHaveBeenCalledTimes(1)
  })

  it('retries once on 401 PGRST303 and returns the second answer', async () => {
    const base = vi
      .fn()
      .mockResolvedValueOnce(res(401, skewBody))
      .mockResolvedValueOnce(res(200, '[{"id":"a"}]'))
    const fetchWithRetry = withClockSkewRetry(base, 0)

    const response = await fetchWithRetry('https://db.example/rest/v1/x', {
      method: 'POST',
      body: '{"title":"t"}',
    })
    expect(response.status).toBe(200)
    expect(base).toHaveBeenCalledTimes(2)
    // The replay is the same request: same input, same init.
    expect(base.mock.calls[0]).toEqual(base.mock.calls[1])
  })

  it('gives up after one retry when the skew outlasts the delay', async () => {
    const base = vi.fn(async () => res(401, skewBody))
    const fetchWithRetry = withClockSkewRetry(base, 0)

    const response = await fetchWithRetry('https://db.example/rest/v1/x')
    expect(response.status).toBe(401)
    expect(base).toHaveBeenCalledTimes(2)
  })

  it('does not retry other 401s, and their body stays readable', async () => {
    const expiredBody = JSON.stringify({ code: 'PGRST301', message: 'JWT expired' })
    const base = vi.fn(async () => res(401, expiredBody))
    const fetchWithRetry = withClockSkewRetry(base, 0)

    const response = await fetchWithRetry('https://db.example/rest/v1/x')
    expect(response.status).toBe(401)
    expect(base).toHaveBeenCalledTimes(1)
    expect(await response.json()).toEqual({ code: 'PGRST301', message: 'JWT expired' })
  })

  it('does not retry non-401 failures', async () => {
    const base = vi.fn(async () => res(500, '{"message":"boom"}'))
    const fetchWithRetry = withClockSkewRetry(base, 0)

    const response = await fetchWithRetry('https://db.example/rest/v1/x')
    expect(response.status).toBe(500)
    expect(base).toHaveBeenCalledTimes(1)
  })

  it('handles a non JSON 401 without retrying or throwing', async () => {
    const base = vi.fn(async () => new Response('nope', { status: 401 }))
    const fetchWithRetry = withClockSkewRetry(base, 0)

    const response = await fetchWithRetry('https://db.example/rest/v1/x')
    expect(response.status).toBe(401)
    expect(await response.text()).toBe('nope')
    expect(base).toHaveBeenCalledTimes(1)
  })
})
