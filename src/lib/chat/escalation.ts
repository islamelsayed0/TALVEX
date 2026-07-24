import 'server-only'

import { auth } from '@clerk/nextjs/server'

import { createOrgScopedClient } from '@/lib/db/client'
import { OrgNotSyncedError } from '@/lib/db/monitors'
import type { ChatMessage } from '@/lib/db/types'
import { readProviderKey } from './key-vault'
import { generateReply } from './providers'
import { isAiProvider } from './providers-meta'

/**
 * Draft a ticket from a chat conversation for escalation (Task 5 addendum). The
 * title and summary are AI drafted from the transcript, then fully editable by
 * the member before submit. If drafting fails for any reason (no key, provider
 * down), a solid deterministic draft is used instead, so the escalation path
 * NEVER dead ends: the recommended path always reaches a prefilled ticket form.
 *
 * The caller must be the conversation's creator; RLS enforces visibility and
 * this checks ownership. The assistant never creates the ticket itself; this
 * only produces the prefill, and the member confirms and submits.
 */

const DRAFT_SYSTEM = `You are drafting a help desk ticket from a chat transcript between a person and an assistant. Write a short, specific title on the first line, no label, under twelve words. Then a blank line. Then a plain language summary of the problem and what was already tried, two to four short sentences, written for the IT team. Add no preamble and no closing. Do not invent details that are not in the transcript.`

const TITLE_MAX = 200
const TRANSCRIPT_MAX_CHARS = 12000

export type EscalationDraft = { title: string; description: string }

function fallbackDraft(
  conversationTitle: string,
  messages: ChatMessage[],
): EscalationDraft {
  const firstUser = messages.find((m) => m.role === 'user')?.content ?? ''
  const lines = [
    'This request was started with the assistant and sent to the team.',
  ]
  if (firstUser) {
    lines.push('', 'What was asked:', firstUser)
  }
  lines.push('', 'You can edit anything above before sending.')
  return {
    title: `Help needed: ${conversationTitle}`.slice(0, TITLE_MAX),
    description: lines.join('\n'),
  }
}

function parseDraft(text: string, fallback: EscalationDraft): EscalationDraft {
  const trimmed = text.trim()
  if (trimmed === '') return fallback
  const nl = trimmed.indexOf('\n')
  const rawTitle = (nl === -1 ? trimmed : trimmed.slice(0, nl)).trim()
  const rawBody = (nl === -1 ? '' : trimmed.slice(nl + 1)).trim()
  // Strip a stray wrapping quote or markdown heading marker from the title.
  const title = rawTitle.replace(/^["'#\s]+|["']+$/g, '').slice(0, TITLE_MAX)
  return {
    title: title || fallback.title,
    description: rawBody || trimmed,
  }
}

export async function draftEscalation(
  conversationId: string,
): Promise<EscalationDraft> {
  const { userId } = await auth()
  if (!userId) throw new Error('No signed in user on this session.')

  const { client, orgId } = await createOrgScopedClient()

  const { data: convo, error: cErr } = await client
    .from('chat_conversations')
    .select('id, created_by, title')
    .eq('id', conversationId)
    .maybeSingle()
  if (cErr) throw cErr
  if (!convo || convo.created_by !== userId) {
    throw new Error('That conversation is not available.')
  }

  const { data: messages, error: mErr } = await client
    .from('chat_messages')
    .select()
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
  if (mErr) throw mErr

  const fallback = fallbackDraft(convo.title, messages ?? [])

  // Try an AI draft; any failure falls back so escalation never dead ends.
  try {
    const { data: org } = await client
      .from('organizations')
      .select('id')
      .eq('clerk_org_id', orgId)
      .maybeSingle()
    if (!org) throw new OrgNotSyncedError()

    const { data: providerRows } = await client.rpc('org_api_key_providers')
    const providers = (providerRows ?? []).filter(isAiProvider)
    if (providers.length === 0) return fallback

    const apiKey = await readProviderKey(org.id, providers[0])
    if (!apiKey) return fallback

    const transcript = (messages ?? [])
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n')
      .slice(0, TRANSCRIPT_MAX_CHARS)

    const reply = await generateReply({
      provider: providers[0],
      apiKey,
      system: DRAFT_SYSTEM,
      messages: [{ role: 'user', content: `Transcript:\n\n${transcript}` }],
    })
    return parseDraft(reply.text, fallback)
  } catch {
    return fallback
  }
}
