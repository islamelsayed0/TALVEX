import type { AiProvider } from '@/lib/db/types'

/**
 * Provider metadata safe for both server and client. Unlike providers.ts (which
 * handles keys and is server only), this module holds no secrets: just the list
 * of providers and their display labels, so a client component (the chat
 * provider picker) can render them. No hyphens in labels, per the copy rule.
 */

export const AI_PROVIDERS: readonly AiProvider[] = ['anthropic', 'openai', 'google']

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
}

export function isAiProvider(value: string): value is AiProvider {
  return (AI_PROVIDERS as readonly string[]).includes(value)
}
