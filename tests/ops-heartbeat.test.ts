import { readFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'

import { SWEEP_STALE_AFTER_SECONDS } from '@/lib/monitoring/heartbeat'

/**
 * The public freshness endpoint and the workflow that polls it.
 *
 * Two things are worth guarding. The payload must stay exactly three keys,
 * because it is served unauthenticated and a field added later would be
 * disclosed to anyone; and the workflow must keep using --fail, because
 * without it the job goes green on a 503 and the whole watcher silently stops
 * watching. That second one is the same class of failure this endpoint exists
 * to catch, which is why it is asserted rather than trusted.
 */

const freshness = vi.hoisted(() => ({ value: { state: 'fresh', ageSeconds: 12 } as unknown }))

vi.mock('@/lib/db/heartbeat', () => ({
  readPublicSweepFreshness: async () => freshness.value,
}))

const { GET } = await import('@/app/api/ops/heartbeat/route')

function request(ip: string) {
  return new Request('http://localhost/api/ops/heartbeat', {
    headers: { 'x-forwarded-for': ip },
  })
}

describe('GET /api/ops/heartbeat', () => {
  it('answers 200 with the payload while the sweep is fresh', async () => {
    freshness.value = { state: 'fresh', ageSeconds: 12 }
    const response = await GET(request('203.0.113.1'))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      stale: false,
      ageSeconds: 12,
      thresholdSeconds: SWEEP_STALE_AFTER_SECONDS,
    })
  })

  it('answers 503 when the sweep is stale, so curl --fail is the whole check', async () => {
    freshness.value = { state: 'stale', ageSeconds: 4000 }
    const response = await GET(request('203.0.113.2'))
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ stale: true, ageSeconds: 4000 })
  })

  it('answers 503 when the sweep has never reported', async () => {
    freshness.value = { state: 'never' }
    const response = await GET(request('203.0.113.3'))
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ stale: true, ageSeconds: null })
  })

  it('discloses exactly three keys and nothing from the row', async () => {
    freshness.value = { state: 'fresh', ageSeconds: 5 }
    const body = (await (await GET(request('203.0.113.4'))).json()) as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(['ageSeconds', 'stale', 'thresholdSeconds'])
    // The operational counts are ungranted to anon, but assert the shape too
    // so a future edit cannot select and expose them.
    for (const forbidden of ['run_count', 'step_failures', 'duration_ms', 'updated_at']) {
      expect(body).not.toHaveProperty(forbidden)
    }
  })

  it('is never cached, because a cached liveness answer is a lie with a timestamp', async () => {
    freshness.value = { state: 'fresh', ageSeconds: 5 }
    const response = await GET(request('203.0.113.5'))
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('rate limits a caller hammering it', async () => {
    freshness.value = { state: 'fresh', ageSeconds: 5 }
    const ip = '203.0.113.99'
    for (let i = 0; i < 30; i++) {
      expect((await GET(request(ip))).status).toBe(200)
    }
    expect((await GET(request(ip))).status).toBe(429)
  })
})

describe('the watcher workflow', () => {
  const yaml = readFileSync('.github/workflows/heartbeat.yml', 'utf8')

  it('is scheduled and can also be run by hand', () => {
    expect(yaml).toMatch(/schedule:/)
    expect(yaml).toMatch(/cron:\s*"\*\/30 \* \* \* \*"/)
    expect(yaml).toMatch(/workflow_dispatch:/)
  })

  it('targets the production origin and the freshness endpoint', () => {
    expect(yaml).toContain('https://talvex-chi.vercel.app/api/ops/heartbeat')
  })

  it('uses --fail, without which a 503 would pass and the watcher would stop watching', () => {
    expect(yaml).toContain('--fail')
  })

  it('asks for no write permission', () => {
    expect(yaml).toMatch(/permissions:\s*\n\s*contents: read/)
  })
})
