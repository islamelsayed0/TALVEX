import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_MODELS,
  generateReply,
  ProviderError,
  validateKey,
} from '@/lib/chat/providers'

/**
 * Ruling 4: a failed provider call with a bad key must produce log output that
 * contains no fragment of the key. This is the explicit test the ruling asks
 * for. It plants the key in BOTH places a careless implementation might leak it
 * from, the request (via the apiKey argument) and the provider's response body,
 * then asserts none of it reaches any console channel. It also asserts a log
 * line WAS produced, so the test is not vacuously green.
 */

const FAKE_KEY = 'FAKEKEY-do-not-log-provider-token'

let logged: string[]
const channels: Array<keyof Console> = ['info', 'log', 'warn', 'error', 'debug']
const spies: ReturnType<typeof vi.spyOn>[] = []

beforeEach(() => {
  logged = []
  for (const ch of channels) {
    spies.push(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.spyOn(console, ch as any).mockImplementation((...args: unknown[]) => {
        logged.push(args.map((a) => String(a)).join(' '))
      }),
    )
  }
})

afterEach(() => {
  for (const s of spies) s.mockRestore()
  spies.length = 0
  vi.restoreAllMocks()
})

function mockFetch(status: number, body: unknown) {
  global.fetch = vi.fn(async () =>
    // The body deliberately echoes the key, simulating a provider that reflects
    // auth back. Nothing that reads or logs the body may leak it.
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  ) as unknown as typeof fetch
}

function assertNoKeyLeak() {
  expect(logged.length).toBeGreaterThan(0) // something WAS logged
  for (const line of logged) {
    expect(line).not.toContain(FAKE_KEY)
    expect(line).not.toContain(FAKE_KEY.slice(-8))
  }
}

describe('provider call logging never leaks the key', () => {
  for (const provider of ['anthropic', 'openai', 'google'] as const) {
    it(`${provider}: a rejected generateReply logs status but not the key`, async () => {
      mockFetch(401, { error: { message: `bad key: ${FAKE_KEY}` } })
      await expect(
        generateReply({
          provider,
          apiKey: FAKE_KEY,
          system: 'test',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      ).rejects.toBeInstanceOf(ProviderError)
      assertNoKeyLeak()
    })

    it(`${provider}: a rejected validateKey logs status but not the key`, async () => {
      mockFetch(401, { error: `invalid: ${FAKE_KEY}` })
      await expect(validateKey(provider, FAKE_KEY)).rejects.toBeInstanceOf(ProviderError)
      assertNoKeyLeak()
    })
  }

  it('a successful call also logs no key material', async () => {
    // Anthropic shaped success body.
    mockFetch(200, {
      model: DEFAULT_MODELS.anthropic,
      content: [{ type: 'text', text: 'hello' }],
      usage: { input_tokens: 3, output_tokens: 2 },
    })
    const reply = await generateReply({
      provider: 'anthropic',
      apiKey: FAKE_KEY,
      system: 'test',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(reply.text).toBe('hello')
    expect(reply.inputTokens).toBe(3)
    assertNoKeyLeak()
  })

  it('the ProviderError message is a remediation, not the raw provider body', async () => {
    mockFetch(429, { error: { message: FAKE_KEY } })
    const err = await generateReply({
      provider: 'openai',
      apiKey: FAKE_KEY,
      system: 'test',
      messages: [{ role: 'user', content: 'hi' }],
    }).catch((e) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect(err.message).not.toContain(FAKE_KEY)
    expect(err.message.toLowerCase()).toContain('rate limit')
  })
})
