import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DISCORD_DOWN_COLOR,
  DISCORD_RECOVERED_COLOR,
  buildDownEmbed,
  buildRecoveredEmbed,
  normalizeDiscordWebhookUrl,
} from '@/lib/notifications/discord'
import {
  buildDownEmail,
  buildRecoveredEmail,
  resetEmailLogGuards,
  sendAlertEmail,
} from '@/lib/notifications/email'
import {
  notifyIncidentEvent,
  reopenInsideCooldown,
  type NotifyChannelSettings,
  type NotifySenders,
} from '@/lib/notifications/dispatch'

// Unit suite for the F10 notification modules. Everything here is pure or
// runs against injected fake senders; no network, no database, no real
// provider keys or webhook URLs anywhere.

const MONITOR = { name: 'Prod API', url: 'https://api.example.com/health' }
const WEBHOOK = 'https://discord.com/api/webhooks/123/fake-token'

function settings(overrides: Partial<NotifyChannelSettings> = {}): NotifyChannelSettings {
  return {
    notificationEmail: null,
    discordWebhook: null,
    emailOnOpen: true,
    emailOnResolve: true,
    alertCooldownMinutes: 30,
    ...overrides,
  }
}

function fakeSenders() {
  const emailCalls: { to: string; subject: string; text: string }[] = []
  const discordCalls: { webhookUrl: string; title: string }[] = []
  const senders: NotifySenders = {
    sendEmail: async (input) => {
      emailCalls.push(input)
    },
    postDiscord: async (webhookUrl, embed) => {
      discordCalls.push({ webhookUrl, title: embed.title })
      return { ok: true }
    },
  }
  return { senders, emailCalls, discordCalls }
}

describe('normalizeDiscordWebhookUrl', () => {
  it('accepts a discord.com webhook URL', () => {
    expect(normalizeDiscordWebhookUrl(WEBHOOK)).toBe(WEBHOOK)
  })

  it('accepts discordapp.com and trims whitespace', () => {
    expect(
      normalizeDiscordWebhookUrl('  https://discordapp.com/api/webhooks/1/t  '),
    ).toBe('https://discordapp.com/api/webhooks/1/t')
  })

  it('refuses the wrong host', () => {
    expect(
      normalizeDiscordWebhookUrl('https://evil.com/api/webhooks/123/fake'),
    ).toBeNull()
    expect(
      normalizeDiscordWebhookUrl('https://discord.com.evil.com/api/webhooks/1/t'),
    ).toBeNull()
  })

  it('refuses http', () => {
    expect(
      normalizeDiscordWebhookUrl('http://discord.com/api/webhooks/123/fake'),
    ).toBeNull()
  })

  it('refuses the wrong path', () => {
    expect(normalizeDiscordWebhookUrl('https://discord.com/api/other/123')).toBeNull()
  })

  it('refuses garbage and empty input', () => {
    expect(normalizeDiscordWebhookUrl('not a url')).toBeNull()
    expect(normalizeDiscordWebhookUrl('')).toBeNull()
    expect(normalizeDiscordWebhookUrl('   ')).toBeNull()
  })
})

describe('builders carry Talvex copy and design system colors', () => {
  it('subjects are the F10 contract', () => {
    expect(
      buildDownEmail({ monitorName: 'X', monitorUrl: 'u', occurredAtIso: '2026-07-27T10:00:00.000Z', reopened: false }).subject,
    ).toBe('[Talvex] X is down')
    expect(
      buildRecoveredEmail({ monitorName: 'X', monitorUrl: 'u', occurredAtIso: '2026-07-27T10:00:00.000Z' }).subject,
    ).toBe('[Talvex] X recovered')
  })

  it('embed colors are the status tokens, not the NetPulse palette', () => {
    expect(DISCORD_DOWN_COLOR).toBe(0xf87171)
    expect(DISCORD_RECOVERED_COLOR).toBe(0x4ade80)
    expect(
      buildDownEmbed({ monitorName: 'X', monitorUrl: 'u', occurredAtIso: '2026-07-27T10:00:00.000Z', reopened: false }).color,
    ).toBe(DISCORD_DOWN_COLOR)
    expect(
      buildRecoveredEmbed({ monitorName: 'X', monitorUrl: 'u', occurredAtIso: '2026-07-27T10:00:00.000Z' }).color,
    ).toBe(DISCORD_RECOVERED_COLOR)
  })
})

describe('dispatch fans out by configuration', () => {
  const ctx = { occurredAtIso: '2026-07-27T10:00:00.000Z', lastNotifiedAtIso: null }

  it('email only: sends email, never touches Discord', async () => {
    const { senders, emailCalls, discordCalls } = fakeSenders()
    const { attempted } = await notifyIncidentEvent(
      settings({ notificationEmail: 'ops@example.com' }),
      MONITOR, 'open', ctx, senders,
    )
    expect(attempted).toBe(true)
    expect(emailCalls).toHaveLength(1)
    expect(emailCalls[0].to).toBe('ops@example.com')
    expect(emailCalls[0].subject).toBe('[Talvex] Prod API is down')
    expect(discordCalls).toHaveLength(0)
  })

  it('discord only: posts the embed, never emails', async () => {
    const { senders, emailCalls, discordCalls } = fakeSenders()
    const { attempted } = await notifyIncidentEvent(
      settings({ discordWebhook: WEBHOOK }),
      MONITOR, 'resolve', ctx, senders,
    )
    expect(attempted).toBe(true)
    expect(discordCalls).toHaveLength(1)
    expect(discordCalls[0].webhookUrl).toBe(WEBHOOK)
    expect(discordCalls[0].title).toBe('Prod API recovered')
    expect(emailCalls).toHaveLength(0)
  })

  it('both configured: both fire', async () => {
    const { senders, emailCalls, discordCalls } = fakeSenders()
    await notifyIncidentEvent(
      settings({ notificationEmail: 'ops@example.com', discordWebhook: WEBHOOK }),
      MONITOR, 'open', ctx, senders,
    )
    expect(emailCalls).toHaveLength(1)
    expect(discordCalls).toHaveLength(1)
  })

  it('neither configured: nothing fires and nothing is attempted', async () => {
    const { senders, emailCalls, discordCalls } = fakeSenders()
    const { attempted } = await notifyIncidentEvent(settings(), MONITOR, 'open', ctx, senders)
    expect(attempted).toBe(false)
    expect(emailCalls).toHaveLength(0)
    expect(discordCalls).toHaveLength(0)
  })

  it('email_on_open off suppresses the open email but not Discord', async () => {
    const { senders, emailCalls, discordCalls } = fakeSenders()
    const { attempted } = await notifyIncidentEvent(
      settings({
        notificationEmail: 'ops@example.com',
        discordWebhook: WEBHOOK,
        emailOnOpen: false,
      }),
      MONITOR, 'open', ctx, senders,
    )
    expect(attempted).toBe(true)
    expect(emailCalls).toHaveLength(0)
    expect(discordCalls).toHaveLength(1)
  })

  it('email_on_resolve off suppresses the resolve email but not Discord', async () => {
    const { senders, emailCalls, discordCalls } = fakeSenders()
    await notifyIncidentEvent(
      settings({
        notificationEmail: 'ops@example.com',
        discordWebhook: WEBHOOK,
        emailOnResolve: false,
      }),
      MONITOR, 'resolve', ctx, senders,
    )
    expect(emailCalls).toHaveLength(0)
    expect(discordCalls).toHaveLength(1)
  })

  it('a reopen email is gated by email_on_open and says the incident reopened', async () => {
    const { senders, emailCalls } = fakeSenders()
    await notifyIncidentEvent(
      settings({ notificationEmail: 'ops@example.com' }),
      MONITOR, 'reopen', ctx, senders,
    )
    expect(emailCalls).toHaveLength(1)
    expect(emailCalls[0].text).toContain('reopened')
  })

  it('a provider throw is swallowed and logged; the other channel still fires', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const discordCalls: string[] = []
    const senders: NotifySenders = {
      sendEmail: async () => {
        throw new Error('provider exploded')
      },
      postDiscord: async (_url, embed) => {
        discordCalls.push(embed.title)
        return { ok: true }
      },
    }
    await expect(
      notifyIncidentEvent(
        settings({ notificationEmail: 'ops@example.com', discordWebhook: WEBHOOK }),
        MONITOR, 'open', ctx, senders,
      ),
    ).resolves.toEqual({ attempted: true })
    expect(discordCalls).toHaveLength(1)
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('a Discord ok false result is logged, never thrown', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const senders: NotifySenders = {
      sendEmail: async () => {},
      postDiscord: async () => ({ ok: false, error: 'Discord returned HTTP 429' }),
    }
    await expect(
      notifyIncidentEvent(settings({ discordWebhook: WEBHOOK }), MONITOR, 'open', ctx, senders),
    ).resolves.toEqual({ attempted: true })
    expect(errorSpy).toHaveBeenCalledWith('notifications: Discord returned HTTP 429')
    errorSpy.mockRestore()
  })
})

describe('the reopen cooldown', () => {
  const base = '2026-07-27T10:00:00.000Z'
  const tenMinutesLater = '2026-07-27T10:10:00.000Z'
  const twoHoursLater = '2026-07-27T12:00:00.000Z'

  it('a reopen inside the window sends nothing on any channel', async () => {
    const { senders, emailCalls, discordCalls } = fakeSenders()
    const { attempted } = await notifyIncidentEvent(
      settings({ notificationEmail: 'ops@example.com', discordWebhook: WEBHOOK }),
      MONITOR, 'reopen',
      { occurredAtIso: tenMinutesLater, lastNotifiedAtIso: base },
      senders,
    )
    expect(attempted).toBe(false)
    expect(emailCalls).toHaveLength(0)
    expect(discordCalls).toHaveLength(0)
  })

  it('a reopen outside the window sends', async () => {
    const { senders, discordCalls } = fakeSenders()
    const { attempted } = await notifyIncidentEvent(
      settings({ discordWebhook: WEBHOOK }),
      MONITOR, 'reopen',
      { occurredAtIso: twoHoursLater, lastNotifiedAtIso: base },
      senders,
    )
    expect(attempted).toBe(true)
    expect(discordCalls).toHaveLength(1)
  })

  it('a reopen with no prior notification sends', () => {
    expect(
      reopenInsideCooldown('reopen', { occurredAtIso: tenMinutesLater, lastNotifiedAtIso: null }, 30),
    ).toBe(false)
  })

  it('open and resolve ignore the window entirely', async () => {
    const { senders, discordCalls } = fakeSenders()
    const inWindow = { occurredAtIso: tenMinutesLater, lastNotifiedAtIso: base }
    await notifyIncidentEvent(settings({ discordWebhook: WEBHOOK }), MONITOR, 'open', inWindow, senders)
    await notifyIncidentEvent(settings({ discordWebhook: WEBHOOK }), MONITOR, 'resolve', inWindow, senders)
    expect(discordCalls).toHaveLength(2)
    expect(reopenInsideCooldown('open', inWindow, 30)).toBe(false)
    expect(reopenInsideCooldown('resolve', inWindow, 30)).toBe(false)
  })

  it('a zero cooldown never suppresses', () => {
    expect(
      reopenInsideCooldown('reopen', { occurredAtIso: base, lastNotifiedAtIso: base }, 0),
    ).toBe(false)
  })
})

describe('email degrades gracefully without Resend configuration', () => {
  beforeEach(() => {
    resetEmailLogGuards()
    vi.stubEnv('RESEND_API_KEY', '')
    vi.stubEnv('RESEND_FROM', '')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('skips silently and logs the missing key exactly once', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await sendAlertEmail({ to: 'ops@example.com', subject: 's', text: 't' })
    await sendAlertEmail({ to: 'ops@example.com', subject: 's', text: 't' })
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy).toHaveBeenCalledWith(
      'notifications: RESEND_API_KEY is not set; alert emails are skipped.',
    )
    errorSpy.mockRestore()
  })

  it('logs the missing From exactly once when only the key is set', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_fake_key_for_tests') // gitleaks:allow
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await sendAlertEmail({ to: 'ops@example.com', subject: 's', text: 't' })
    await sendAlertEmail({ to: 'ops@example.com', subject: 's', text: 't' })
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy).toHaveBeenCalledWith(
      'notifications: RESEND_FROM is not set; alert emails are skipped.',
    )
    errorSpy.mockRestore()
  })
})
