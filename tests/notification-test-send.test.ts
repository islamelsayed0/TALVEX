import { afterEach, describe, expect, it } from 'vitest'

import {
  DISCORD_DOWN_COLOR,
  DISCORD_RECOVERED_COLOR,
  DISCORD_TEST_COLOR,
  buildTestEmbed,
} from '@/lib/notifications/discord'
import {
  buildTestEmail,
  resetEmailLogGuards,
  sendAlertEmailResult,
} from '@/lib/notifications/email'

/**
 * The Settings "Send a test" path: a clearly-labelled test that reports the
 * outcome, unlike the incident path which swallows failures.
 */

describe('buildTestEmbed', () => {
  it('uses the accent color, never a reserved status color', () => {
    const e = buildTestEmbed()
    expect(e.color).toBe(DISCORD_TEST_COLOR)
    expect(e.color).not.toBe(DISCORD_DOWN_COLOR)
    expect(e.color).not.toBe(DISCORD_RECOVERED_COLOR)
    expect(e.title.toLowerCase()).toContain('test')
  })
})

describe('buildTestEmail', () => {
  it('is clearly labelled a test, not a real incident', () => {
    const m = buildTestEmail()
    expect(m.subject).toContain('Test')
    expect(m.text.toLowerCase()).toContain('not a real incident')
  })
})

describe('sendAlertEmailResult', () => {
  const savedKey = process.env.RESEND_API_KEY
  const savedFrom = process.env.RESEND_FROM

  afterEach(() => {
    if (savedKey === undefined) delete process.env.RESEND_API_KEY
    else process.env.RESEND_API_KEY = savedKey
    if (savedFrom === undefined) delete process.env.RESEND_FROM
    else process.env.RESEND_FROM = savedFrom
    resetEmailLogGuards()
  })

  it('reports the missing key instead of silently skipping', async () => {
    delete process.env.RESEND_API_KEY
    resetEmailLogGuards()
    const r = await sendAlertEmailResult({ to: 'a@b.com', subject: 's', text: 't' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/RESEND_API_KEY/)
  })

  it('reports the missing from when the key is set but from is not', async () => {
    process.env.RESEND_API_KEY = 're_test_not_a_real_key'
    delete process.env.RESEND_FROM
    resetEmailLogGuards()
    const r = await sendAlertEmailResult({ to: 'a@b.com', subject: 's', text: 't' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/RESEND_FROM/)
  })
})
