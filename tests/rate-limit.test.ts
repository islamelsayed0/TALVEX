import { describe, expect, it } from 'vitest'

import { clientIp, createSlidingWindow } from '@/lib/rate-limit'

/**
 * The shared sliding window. The clock is injected everywhere, so none of this
 * sleeps and every boundary is exact.
 *
 * The rule worth guarding is that a blocked attempt is not counted. Without
 * it, a caller hammering a limited endpoint keeps pushing its own window
 * forward and never recovers, which quietly turns a rate limit into a
 * permanent ban for anyone who trips it once.
 */

const CONFIG = { max: 3, windowMs: 1000 }

describe('createSlidingWindow', () => {
  it('allows up to max and blocks the next attempt', () => {
    const w = createSlidingWindow(CONFIG)
    expect(w.check('k', 0).allowed).toBe(true)
    expect(w.check('k', 1).allowed).toBe(true)
    expect(w.check('k', 2).allowed).toBe(true)
    expect(w.check('k', 3).allowed).toBe(false)
  })

  it('reports remaining allowance as the window fills', () => {
    const w = createSlidingWindow(CONFIG)
    expect(w.check('k', 0).remaining).toBe(2)
    expect(w.check('k', 1).remaining).toBe(1)
    expect(w.check('k', 2).remaining).toBe(0)
  })

  it('does not count a blocked attempt, so hammering cannot extend the ban', () => {
    const w = createSlidingWindow(CONFIG)
    for (const t of [0, 1, 2]) w.check('k', t)

    // Hammer well past the point where a counted attempt would keep the window
    // permanently full.
    for (let t = 3; t < 999; t++) w.check('k', t)

    // The three original entries expire at 1000, 1001, 1002 regardless.
    expect(w.check('k', 1001).allowed).toBe(true)
  })

  it('slides: allowance returns as old entries age out', () => {
    const w = createSlidingWindow(CONFIG)
    w.check('k', 0)
    w.check('k', 500)
    w.check('k', 600)
    expect(w.check('k', 700).allowed).toBe(false)
    // The entry at 0 has now aged out of the 1000ms window.
    expect(w.check('k', 1001).allowed).toBe(true)
  })

  it('reports how long until an attempt frees up', () => {
    const w = createSlidingWindow(CONFIG)
    w.check('k', 0)
    w.check('k', 100)
    w.check('k', 200)
    const blocked = w.check('k', 300)
    expect(blocked.allowed).toBe(false)
    // The oldest entry is at 0, so it leaves the window at 1000.
    expect(blocked.retryAfterMs).toBe(700)
  })

  it('never reports a negative retry', () => {
    const w = createSlidingWindow({ max: 1, windowMs: 100 })
    w.check('k', 0)
    expect(w.check('k', 99).retryAfterMs).toBeGreaterThanOrEqual(0)
  })

  it('keys are independent', () => {
    const w = createSlidingWindow(CONFIG)
    for (const t of [0, 1, 2]) w.check('a', t)
    expect(w.check('a', 3).allowed).toBe(false)
    expect(w.check('b', 3).allowed).toBe(true)
  })

  it('two limiters never share state, even for the same key', () => {
    const a = createSlidingWindow(CONFIG)
    const b = createSlidingWindow(CONFIG)
    for (const t of [0, 1, 2]) a.check('same', t)
    expect(a.check('same', 3).allowed).toBe(false)
    expect(b.check('same', 3).allowed).toBe(true)
  })

  it('reset clears every window', () => {
    const w = createSlidingWindow(CONFIG)
    for (const t of [0, 1, 2]) w.check('k', t)
    expect(w.check('k', 3).allowed).toBe(false)
    w.reset()
    expect(w.check('k', 3).allowed).toBe(true)
  })
})

describe('clientIp', () => {
  it('takes the original client from x-forwarded-for, not the proxy', () => {
    const h = new Headers({ 'x-forwarded-for': '203.0.113.7, 70.41.3.18, 150.172.238.178' })
    expect(clientIp(h)).toBe('203.0.113.7')
  })

  it('trims whitespace', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '  203.0.113.7  ' }))).toBe('203.0.113.7')
  })

  it('falls back to x-real-ip', () => {
    expect(clientIp(new Headers({ 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4')
  })

  it('shares one bucket when there is no address, rather than going unlimited', () => {
    // Treating unknown as unlimited would mean the limit is bypassed by
    // whatever strips the header, which is exactly the traffic worth slowing.
    expect(clientIp(new Headers())).toBe('unknown')
    expect(clientIp(new Headers({ 'x-forwarded-for': '' }))).toBe('unknown')
  })
})
