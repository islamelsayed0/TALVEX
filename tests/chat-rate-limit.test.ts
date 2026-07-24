import { beforeEach, describe, expect, it } from 'vitest'

import {
  CHAT_RATE_LIMIT,
  checkChatRateLimit,
  resetChatRateLimit,
} from '@/lib/chat/rate-limit'

// The application layer rate limit that protects the customer's key from a
// runaway loop (Task 5). Deterministic: the clock is injected.

beforeEach(() => resetChatRateLimit())

describe('chat rate limit', () => {
  it('allows up to the max sends in a window, then blocks', () => {
    const t = 1_000_000
    for (let i = 0; i < CHAT_RATE_LIMIT.max; i++) {
      const d = checkChatRateLimit('orgA', 'userA', t)
      expect(d.allowed).toBe(true)
    }
    const blocked = checkChatRateLimit('orgA', 'userA', t)
    expect(blocked.allowed).toBe(false)
    expect(blocked.remaining).toBe(0)
    expect(blocked.retryAfterMs).toBeGreaterThan(0)
  })

  it('does not count a blocked attempt, so hammering cannot push the window forward', () => {
    const t = 2_000_000
    for (let i = 0; i < CHAT_RATE_LIMIT.max; i++) checkChatRateLimit('orgA', 'userA', t)
    // Many blocked attempts, all at the same instant.
    for (let i = 0; i < 100; i++) {
      expect(checkChatRateLimit('orgA', 'userA', t).allowed).toBe(false)
    }
    // Once the window fully elapses, sends are allowed again.
    const later = t + CHAT_RATE_LIMIT.windowMs + 1
    expect(checkChatRateLimit('orgA', 'userA', later).allowed).toBe(true)
  })

  it('scopes the window per user and per org', () => {
    const t = 3_000_000
    for (let i = 0; i < CHAT_RATE_LIMIT.max; i++) checkChatRateLimit('orgA', 'userA', t)
    // A different user in the same org is unaffected.
    expect(checkChatRateLimit('orgA', 'userB', t).allowed).toBe(true)
    // The same user id in a different org is unaffected.
    expect(checkChatRateLimit('orgB', 'userA', t).allowed).toBe(true)
    // The exhausted bucket is still blocked.
    expect(checkChatRateLimit('orgA', 'userA', t).allowed).toBe(false)
  })

  it('slides: old sends age out of the window', () => {
    const t = 4_000_000
    // Fill the window.
    for (let i = 0; i < CHAT_RATE_LIMIT.max; i++) checkChatRateLimit('orgA', 'userA', t)
    expect(checkChatRateLimit('orgA', 'userA', t).allowed).toBe(false)
    // Just past the window from the first send: one slot frees up.
    const nudge = t + CHAT_RATE_LIMIT.windowMs + 1
    expect(checkChatRateLimit('orgA', 'userA', nudge).allowed).toBe(true)
  })
})
