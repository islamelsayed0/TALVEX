import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { reportOpsError, resetOpsReportGuard } from '@/lib/ops/report'

/**
 * The operator error sink.
 *
 * Three things are worth guarding. It must never throw, because every caller
 * is a catch block and a reporting failure becoming a second incident is
 * exactly the wrong shape. It must carry no tenant data, because the whole
 * codebase holds that line everywhere else. And it must say something once
 * when it is unconfigured rather than on every sweep, because a log line every
 * five minutes is how a real signal gets buried.
 */

const WEBHOOK = 'https://discord.com/api/webhooks/123456789/abcdefghijklmnop'

let posted: Array<{ url: string; body: unknown }>

beforeEach(() => {
  posted = []
  resetOpsReportGuard()
  global.fetch = vi.fn(async (url: unknown, init: unknown) => {
    posted.push({
      url: String(url),
      body: JSON.parse(String((init as { body?: string }).body ?? '{}')),
    })
    return new Response('', { status: 204 })
  }) as unknown as typeof fetch
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('when the webhook is not configured', () => {
  it('posts nothing and says so exactly once', async () => {
    vi.stubEnv('OPS_DISCORD_WEBHOOK', '')
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await reportOpsError({ event: 'cron.sweep.steps_failed' })
    await reportOpsError({ event: 'cron.sweep.steps_failed' })
    await reportOpsError({ event: 'cron.heartbeat.stamp_failed' })

    expect(posted).toHaveLength(0)
    expect(errorSpy).toHaveBeenCalledTimes(1)
    const line = JSON.parse(String(errorSpy.mock.calls[0][0]))
    expect(line.event).toBe('ops.report.not_configured')
    expect(line.detail.variable).toBe('OPS_DISCORD_WEBHOOK')
    errorSpy.mockRestore()
  })
})

describe('when the webhook is configured', () => {
  beforeEach(() => {
    vi.stubEnv('OPS_DISCORD_WEBHOOK', WEBHOOK)
  })

  it('posts the event name and the reason', async () => {
    await reportOpsError({ event: 'cron.sweep.steps_failed', reason: 'listing monitors failed' })
    expect(posted).toHaveLength(1)
    const body = posted[0].body as { embeds: Array<{ fields: Array<{ value: string }> }> }
    const values = body.embeds[0].fields.map((f) => f.value)
    expect(values).toContain('cron.sweep.steps_failed')
    expect(values).toContain('listing monitors failed')
  })

  it('omits the reason field entirely when there is none', async () => {
    await reportOpsError({ event: 'cron.heartbeat.stamp_failed' })
    const body = posted[0].body as { embeds: Array<{ fields: Array<{ name: string }> }> }
    expect(body.embeds[0].fields.map((f) => f.name)).toEqual(['Event'])
  })

  it('refuses a URL that is not a Discord webhook rather than posting to it', async () => {
    vi.stubEnv('OPS_DISCORD_WEBHOOK', 'https://evil.example.com/collect')
    await reportOpsError({ event: 'cron.sweep.steps_failed', reason: 'something' })
    expect(posted).toHaveLength(0)
  })

  it('never throws when Discord fails', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch
    await expect(
      reportOpsError({ event: 'cron.sweep.steps_failed' }),
    ).resolves.toBeUndefined()
  })

  it('never throws when Discord rejects the post', async () => {
    global.fetch = vi.fn(async () => new Response('', { status: 429 })) as unknown as typeof fetch
    await expect(
      reportOpsError({ event: 'cron.sweep.steps_failed' }),
    ).resolves.toBeUndefined()
  })

  it('carries nothing tenant shaped', async () => {
    await reportOpsError({ event: 'cron.digest.send_failed', reason: 'Resend rejected it' })
    const serialized = JSON.stringify(posted[0].body)
    // No org identifier, no address, no ticket text, and never the webhook.
    expect(serialized).not.toContain('org_')
    expect(serialized).not.toContain('@')
    expect(serialized).not.toContain(WEBHOOK)
  })
})
