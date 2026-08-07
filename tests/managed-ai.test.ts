import { afterEach, describe, expect, it, vi } from 'vitest'

import { MANAGED_PROVIDER, platformApiKey } from '@/lib/billing/managed-ai'
import { ManagedCapReachedError } from '@/lib/chat/engine'

// The pure edges of the managed AI path (F13 PR 3). The meter itself is
// proven against the local stack in tests/isolation/managed-ai-isolation;
// what these pin is configuration behavior and the cap copy, which carries
// the recorded promises.

afterEach(() => {
  vi.unstubAllEnvs()
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
