import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  chatEntryMode,
  MANAGED_PROVIDER,
  platformApiKey,
  resolveManagedAccess,
} from '@/lib/billing/managed-ai'
import {
  callProviderOnce,
  ManagedCapReachedError,
  ManagedUnavailableError,
} from '@/lib/chat/engine'

// getEntitlements is the only reach into the database on the branches under
// test here; mocked so the configuration edges are provable without a stack.
vi.mock('@/lib/billing/entitlements', () => ({
  getEntitlements: vi.fn(),
}))
import { getEntitlements } from '@/lib/billing/entitlements'
const getEntitlementsMock = vi.mocked(getEntitlements)

function entitled(aiAnswersIncluded: number) {
  return { aiAnswersIncluded } as Awaited<ReturnType<typeof getEntitlements>>
}

// The pure edges of the managed AI path (F13 PR 3). The meter itself is
// proven against the local stack in tests/isolation/managed-ai-isolation;
// what these pin is configuration behavior and the cap copy, which carries
// the recorded promises.

afterEach(() => {
  vi.unstubAllEnvs()
  getEntitlementsMock.mockReset()
})

describe('platformApiKey', () => {
  it('is null when unset or blank, so the managed path fails closed', () => {
    vi.stubEnv('PLATFORM_ANTHROPIC_API_KEY', '')
    expect(platformApiKey()).toBeNull()
    vi.stubEnv('PLATFORM_ANTHROPIC_API_KEY', '   ')
    expect(platformApiKey()).toBeNull()
  })

  it('returns the configured key', () => {
    vi.stubEnv('PLATFORM_ANTHROPIC_API_KEY', 'sk-ant-test')
    expect(platformApiKey()).toBe('sk-ant-test')
  })
})

describe('the managed path constants', () => {
  it('runs on anthropic', () => {
    expect(MANAGED_PROVIDER).toBe('anthropic')
  })
})

describe('the missing key degrade (platform key resilience)', () => {
  it('an entitled org with no platform key is unavailable, never none', () => {
    vi.stubEnv('PLATFORM_ANTHROPIC_API_KEY', '')
    getEntitlementsMock.mockResolvedValue(entitled(300))
    return expect(resolveManagedAccess('org_x')).resolves.toEqual({
      mode: 'unavailable',
    })
  })

  it('an unentitled org is none, whatever the key situation', async () => {
    vi.stubEnv('PLATFORM_ANTHROPIC_API_KEY', '')
    getEntitlementsMock.mockResolvedValue(entitled(0))
    await expect(resolveManagedAccess('org_x')).resolves.toEqual({ mode: 'none' })
    vi.stubEnv('PLATFORM_ANTHROPIC_API_KEY', 'sk-ant-test')
    getEntitlementsMock.mockResolvedValue(entitled(0))
    await expect(resolveManagedAccess('org_x')).resolves.toEqual({ mode: 'none' })
  })

  it('chatEntryMode surfaces unavailable as its own door', async () => {
    vi.stubEnv('PLATFORM_ANTHROPIC_API_KEY', '')
    getEntitlementsMock.mockResolvedValue(entitled(300))
    await expect(chatEntryMode('org_x', false)).resolves.toBe('unavailable')
  })

  it('BYOK is untouched: a key holding org never consults the platform side', async () => {
    vi.stubEnv('PLATFORM_ANTHROPIC_API_KEY', '')
    await expect(chatEntryMode('org_x', true)).resolves.toBe('byok')
    expect(getEntitlementsMock).not.toHaveBeenCalled()
  })
})

describe('callProviderOnce (platform key resilience)', () => {
  it('makes exactly one attempt, success passes through', async () => {
    const generate = vi.fn().mockResolvedValue({
      text: 'hi',
      model: 'm',
      inputTokens: 1,
      outputTokens: 1,
    })
    const reply = await callProviderOnce({ keySource: 'platform', generate })
    expect(reply.text).toBe('hi')
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('a platform refusal degrades to unavailable after one attempt, no retry', async () => {
    const generate = vi.fn().mockRejectedValue(new Error('spend limit'))
    await expect(
      callProviderOnce({ keySource: 'platform', generate }),
    ).rejects.toBeInstanceOf(ManagedUnavailableError)
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('a BYOK failure passes through unchanged: the org key path is unaffected', async () => {
    const original = new Error('provider said no')
    const generate = vi.fn().mockRejectedValue(original)
    await expect(callProviderOnce({ keySource: 'byok', generate })).rejects.toBe(
      original,
    )
    expect(generate).toHaveBeenCalledTimes(1)
  })
})

describe('the unavailable copy carries the recorded promises', () => {
  it('names the door and the nothing automatic promise', () => {
    const message = new ManagedUnavailableError().message
    expect(message).toContain('Get Help')
    expect(message).toMatch(/nothing upgrades or gets charged on its own/)
  })
})

describe('the cap copy carries the recorded promises', () => {
  // The substance, not the label (house testing rule): the degrade copy must
  // name the door (Get Help), the reset, and the no automatic upgrade or
  // charge promise. Losing any of these turns the recorded degrade behavior
  // into a dead end or a dark pattern.
  it('names the door, the reset, and the nothing automatic promise', () => {
    const message = new ManagedCapReachedError().message
    expect(message).toContain('Get Help')
    expect(message).toContain('resets next month')
    expect(message).toMatch(/nothing upgrades or gets charged on its own/)
  })
})
