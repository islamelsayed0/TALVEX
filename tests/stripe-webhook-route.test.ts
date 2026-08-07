import { afterEach, describe, expect, it, vi } from 'vitest'

import { POST } from '@/app/api/webhooks/stripe/route'

// The Stripe webhook's front door (F13 PR 1). Like the cron route test
// beside these, what needs proving without a stack is rejection: the route
// must fail closed on missing configuration and refuse unverified payloads
// BEFORE any database client exists. The verified happy path runs against
// the local stack in tests/isolation/billing-isolation.test.ts.

const url = 'http://localhost/api/webhooks/stripe'

function post(body: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { method: 'POST', body, headers })
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('POST /api/webhooks/stripe', () => {
  it('returns 503 when STRIPE_WEBHOOK_SECRET is not configured', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', '')
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fake')
    const response = await POST(post('{}') as never)
    expect(response.status).toBe(503)
  })

  it('returns 503 when STRIPE_SECRET_KEY is not configured', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_fake')
    vi.stubEnv('STRIPE_SECRET_KEY', '')
    const response = await POST(post('{}') as never)
    expect(response.status).toBe(503)
  })

  it('returns 400 for a request without a signature header', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_fake')
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fake')
    const response = await POST(post('{}') as never)
    expect(response.status).toBe(400)
  })

  it('returns 400 for a garbage signature', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_fake')
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fake')
    const response = await POST(
      post('{}', { 'stripe-signature': 't=1,v1=not-a-real-signature' }) as never,
    )
    expect(response.status).toBe(400)
  })

  it('returns 400 for a signature minted with the wrong secret', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_the_real_one')
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fake')
    const Stripe = (await import('stripe')).default
    const payload = JSON.stringify({ id: 'evt_1', object: 'event', type: 'ping' })
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: 'whsec_an_imposter',
    })
    const response = await POST(post(payload, { 'stripe-signature': signature }) as never)
    expect(response.status).toBe(400)
  })
})
