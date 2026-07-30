import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The health endpoint.
 *
 * The assertions that matter are about what it does NOT say. A public
 * unauthenticated health route is free reconnaissance if it is chatty, so the
 * body is one key and error text never escapes. It must also never hold a
 * service role client, which is asserted by construction: this test stubs only
 * the anon client, so a handler that reached for the admin one would fail here.
 */

const result = vi.hoisted(() => ({ value: { error: null } as { error: unknown } }))
const anonCalls = vi.hoisted(() => ({ count: 0 }))

vi.mock('@/lib/db/client', () => ({
  createAnonClient: () => {
    anonCalls.count++
    return {
      from: () => ({
        select: () => ({
          limit: async () => result.value,
        }),
      }),
    }
  },
}))

const { GET } = await import('@/app/api/health/route')

function request(ip: string) {
  return new Request('http://localhost/api/health', {
    headers: { 'x-forwarded-for': ip },
  })
}

afterEach(() => {
  result.value = { error: null }
})

describe('GET /api/health', () => {
  it('answers 200 with exactly one key when the database answers', async () => {
    const response = await GET(request('192.0.2.1'))
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(body).toEqual({ ok: true })
    expect(Object.keys(body)).toEqual(['ok'])
  })

  it('treats zero rows as healthy, because the question is whether Postgres answered', async () => {
    // Under the anon policies this select legitimately returns nothing when no
    // org has opted its status page public. That is not an outage.
    result.value = { error: null }
    expect((await GET(request('192.0.2.2'))).status).toBe(200)
  })

  it('answers 503 when the database errors, and leaks no error text', async () => {
    result.value = { error: { message: 'FATAL: password authentication failed for user' } }
    const response = await GET(request('192.0.2.3'))
    expect(response.status).toBe(503)
    const raw = JSON.stringify(await response.json())
    expect(raw).toBe('{"ok":false}')
    expect(raw).not.toContain('password')
  })

  it('discloses no version, environment, timing, or configuration', async () => {
    const raw = JSON.stringify(await (await GET(request('192.0.2.4'))).json())
    for (const leak of ['version', 'env', 'commit', 'region', 'ms', 'url']) {
      expect(raw).not.toContain(leak)
    }
  })

  it('reads through the anon client, never a service role client', async () => {
    const before = anonCalls.count
    await GET(request('192.0.2.5'))
    expect(anonCalls.count).toBe(before + 1)
  })

  it('is not cached', async () => {
    const response = await GET(request('192.0.2.6'))
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('rate limits a caller hammering it', async () => {
    const ip = '192.0.2.99'
    for (let i = 0; i < 60; i++) {
      expect((await GET(request(ip))).status).toBe(200)
    }
    expect((await GET(request(ip))).status).toBe(429)
  })
})
