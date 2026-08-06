import { describe, expect, it } from 'vitest'

import {
  DISCORD_CERT_WARNING_COLOR,
  DISCORD_DOWN_COLOR,
  buildCertExpiryEmbed,
} from '@/lib/notifications/discord'
import { buildCertExpiryEmail } from '@/lib/notifications/email'
import {
  notifyCertExpiry,
  type NotifyChannelSettings,
  type NotifySenders,
} from '@/lib/notifications/dispatch'

// Unit suite for the certificate expiry copy and its fan out. Pure builders
// and injected fake senders; no network anywhere.

const MONITOR = { name: 'Prod API', url: 'https://api.example.com/health' }
const WEBHOOK = 'https://discord.com/api/webhooks/123/fake-token'
const EXPIRES = '2026-08-18T12:00:00Z'

const INFO = { daysLeft: 14, expiresAtIso: EXPIRES, expired: false }

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
  const discordCalls: { webhookUrl: string; title: string; color: number }[] = []
  const senders: NotifySenders = {
    sendEmail: async (input) => {
      emailCalls.push(input)
    },
    postDiscord: async (webhookUrl, embed) => {
      discordCalls.push({ webhookUrl, title: embed.title, color: embed.color })
      return { ok: true }
    },
  }
  return { senders, emailCalls, discordCalls }
}

describe('buildCertExpiryEmail', () => {
  it('carries the exact warning subject', () => {
    const email = buildCertExpiryEmail({
      monitorName: 'Prod API',
      monitorUrl: MONITOR.url,
      daysLeft: 14,
      expiresAtIso: EXPIRES,
      expired: false,
    })
    expect(email.subject).toBe('[Talvext] Certificate for Prod API expires in 14 days')
    expect(email.text).toContain('Monitor: Prod API')
    expect(email.text).toContain(`URL: ${MONITOR.url}`)
    expect(email.text).toContain('Expires: 2026-08-18 12:00 UTC')
  })

  it('handles the singular day and the same day', () => {
    const oneDay = buildCertExpiryEmail({
      monitorName: 'Prod API',
      monitorUrl: MONITOR.url,
      daysLeft: 1,
      expiresAtIso: EXPIRES,
      expired: false,
    })
    expect(oneDay.subject).toBe('[Talvext] Certificate for Prod API expires in 1 day')
    const today = buildCertExpiryEmail({
      monitorName: 'Prod API',
      monitorUrl: MONITOR.url,
      daysLeft: 0,
      expiresAtIso: EXPIRES,
      expired: false,
    })
    expect(today.subject).toBe('[Talvext] Certificate for Prod API expires today')
  })

  it('carries the expired variant', () => {
    const email = buildCertExpiryEmail({
      monitorName: 'Prod API',
      monitorUrl: MONITOR.url,
      daysLeft: -2,
      expiresAtIso: EXPIRES,
      expired: true,
    })
    expect(email.subject).toBe('[Talvext] Certificate for Prod API has expired')
    expect(email.text).toContain('Expired: 2026-08-18 12:00 UTC')
    expect(email.text).toContain('renewed')
  })

  it('uses no hyphens in its prose', () => {
    // CLAUDE.md prose rule. URLs are exempt: an identifier is not prose.
    for (const expired of [false, true]) {
      const email = buildCertExpiryEmail({
        monitorName: 'Prod API',
        monitorUrl: MONITOR.url,
        daysLeft: 3,
        expiresAtIso: EXPIRES,
        expired,
      })
      expect(email.subject).not.toMatch(/-/)
      // URLs and date stamps are exempt: an identifier is not prose.
      const prose = email.text
        .split('\n')
        .filter((line) => !line.includes('://'))
        .map((line) => line.replace(/\d{4}-\d{2}-\d{2}/g, ''))
      for (const line of prose) {
        expect(line, `hyphen in: "${line}"`).not.toMatch(/-/)
      }
    }
  })
})

describe('buildCertExpiryEmbed', () => {
  it('is amber while warning and red once expired', () => {
    const warning = buildCertExpiryEmbed({
      monitorName: 'Prod API',
      monitorUrl: MONITOR.url,
      daysLeft: 3,
      expiresAtIso: EXPIRES,
      expired: false,
    })
    expect(warning.color).toBe(DISCORD_CERT_WARNING_COLOR)
    expect(warning.title).toBe('Certificate for Prod API expires in 3 days')
    const gone = buildCertExpiryEmbed({
      monitorName: 'Prod API',
      monitorUrl: MONITOR.url,
      daysLeft: -1,
      expiresAtIso: EXPIRES,
      expired: true,
    })
    expect(gone.color).toBe(DISCORD_DOWN_COLOR)
    expect(gone.title).toBe('Certificate for Prod API has expired')
  })

  it('encodes the design token colors, not an ad hoc palette', () => {
    expect(DISCORD_CERT_WARNING_COLOR).toBe(0xfbbf24)
  })
})

describe('notifyCertExpiry', () => {
  it('rides the email on open toggle and the webhook presence', async () => {
    const { senders, emailCalls, discordCalls } = fakeSenders()
    const result = await notifyCertExpiry(
      settings({ notificationEmail: 'ops@example.com', discordWebhook: WEBHOOK }),
      MONITOR,
      INFO,
      senders,
    )
    expect(result.attempted).toBe(true)
    expect(emailCalls).toHaveLength(1)
    expect(emailCalls[0].to).toBe('ops@example.com')
    expect(discordCalls).toHaveLength(1)
  })

  it('sends no email when problem emails are off, but Discord still fires', async () => {
    const { senders, emailCalls, discordCalls } = fakeSenders()
    const result = await notifyCertExpiry(
      settings({
        notificationEmail: 'ops@example.com',
        emailOnOpen: false,
        discordWebhook: WEBHOOK,
      }),
      MONITOR,
      INFO,
      senders,
    )
    expect(result.attempted).toBe(true)
    expect(emailCalls).toHaveLength(0)
    expect(discordCalls).toHaveLength(1)
  })

  it('posts nothing without a webhook and attempts nothing with no channels', async () => {
    const { senders, emailCalls, discordCalls } = fakeSenders()
    const result = await notifyCertExpiry(settings(), MONITOR, INFO, senders)
    expect(result.attempted).toBe(false)
    expect(emailCalls).toHaveLength(0)
    expect(discordCalls).toHaveLength(0)
  })

  it('never throws, even when every sender does', async () => {
    const senders: NotifySenders = {
      sendEmail: async () => {
        throw new Error('provider down')
      },
      postDiscord: async () => {
        throw new Error('webhook down')
      },
    }
    const result = await notifyCertExpiry(
      settings({ notificationEmail: 'ops@example.com', discordWebhook: WEBHOOK }),
      MONITOR,
      INFO,
      senders,
    )
    expect(result.attempted).toBe(true)
  })
})
