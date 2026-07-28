import 'server-only'

/**
 * Discord webhook notifications (BRD F10). Ported from NetPulse
 * lib/notifications/discord-webhook.ts: the URL normalizer and the post
 * helper survive nearly verbatim; the embeds are rebuilt with Talvex copy
 * and the design system status colors. Nothing here touches the database.
 *
 * A webhook URL is capability bearing (anyone holding it can post into the
 * channel), so it is never logged; failures log a status code only.
 */

/**
 * Embed accent colors, decimal encodings of the design system status tokens
 * in src/app/globals.css: --status-down #f87171 and --status-up #4ade80.
 * Not NetPulse's palette, per the F10 ruling.
 */
export const DISCORD_DOWN_COLOR = 0xf87171
export const DISCORD_RECOVERED_COLOR = 0x4ade80

const TALVEX_FOOTER = 'Talvex Monitoring'

/**
 * Accepts a Discord webhook URL and returns its normalized form, or null for
 * anything that is not one: https only, discord.com or discordapp.com, path
 * under /api/webhooks/. The settings form refuses to save a null.
 */
export function normalizeDiscordWebhookUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'https:') return null
    const host = url.hostname.toLowerCase()
    if (host !== 'discord.com' && host !== 'discordapp.com') return null
    if (!url.pathname.startsWith('/api/webhooks/')) return null
    return url.toString()
  } catch {
    return null
  }
}

export type DiscordEmbedField = { name: string; value: string; inline?: boolean }

export type DiscordEmbed = {
  title: string
  description?: string
  color: number
  fields?: DiscordEmbedField[]
  timestamp?: string
  footer?: { text: string }
}

/** "2026-07-27T16:50:38.182Z" as the calmer "2026-07-27 16:50 UTC". */
function formatUtcMinute(iso: string): string {
  return `${iso.slice(0, 16).replace('T', ' ')} UTC`
}

/** The embed for a confirmed failure, opening or reopening an incident. */
export function buildDownEmbed(input: {
  monitorName: string
  monitorUrl: string
  occurredAtIso: string
  reopened: boolean
}): DiscordEmbed {
  return {
    title: `${input.monitorName} is down`,
    description: input.reopened
      ? 'The monitor went down again shortly after recovering, so its incident reopened.'
      : 'Two checks in a row failed, so an incident is open.',
    color: DISCORD_DOWN_COLOR,
    fields: [
      { name: 'URL', value: input.monitorUrl, inline: false },
      { name: 'Down since', value: formatUtcMinute(input.occurredAtIso), inline: true },
    ],
    timestamp: input.occurredAtIso,
    footer: { text: TALVEX_FOOTER },
  }
}

/** The embed for a recovery, resolving the incident. */
export function buildRecoveredEmbed(input: {
  monitorName: string
  monitorUrl: string
  occurredAtIso: string
}): DiscordEmbed {
  return {
    title: `${input.monitorName} recovered`,
    description: 'The monitor responded normally again and its incident resolved.',
    color: DISCORD_RECOVERED_COLOR,
    fields: [
      { name: 'URL', value: input.monitorUrl, inline: false },
      { name: 'Recovered at', value: formatUtcMinute(input.occurredAtIso), inline: true },
    ],
    timestamp: input.occurredAtIso,
    footer: { text: TALVEX_FOOTER },
  }
}

/**
 * Posts one embed to a webhook. Never throws: any failure comes back as
 * ok false with a status only description, so the caller can log without
 * ever holding the webhook URL or a response body.
 */
export async function postDiscordWebhook(
  webhookUrl: string,
  embed: DiscordEmbed,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'Talvex', embeds: [embed] }),
    })
    if (!res.ok) {
      return { ok: false, error: `Discord returned HTTP ${res.status}` }
    }
    return { ok: true }
  } catch {
    return { ok: false, error: 'Discord webhook request failed' }
  }
}
