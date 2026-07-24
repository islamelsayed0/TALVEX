import 'server-only'

import { auth } from '@clerk/nextjs/server'

import { createAdminClient } from '@/lib/db/admin'
import { createOrgScopedClient } from '@/lib/db/client'
import { OrgNotSyncedError } from '@/lib/db/monitors'
import { titleFromMessage } from '@/lib/db/chat'
import type { AiProvider } from '@/lib/db/types'
import { readProviderKey } from './key-vault'
import { generateReply, type ChatTurn } from './providers'
import { isAiProvider } from './providers-meta'
import { checkChatRateLimit } from './rate-limit'
import { SYSTEM_PROMPT } from './system-prompt'

/**
 * The chat send path (Task 5). Runs for any member. It reads history and owns
 * conversation creation under the caller's own RLS, reads the org key through
 * the service role (the ciphertext is unreadable to a user session by design),
 * calls the provider, and writes both messages through the service role, since
 * chat_messages is system written like monitor_checks (migration 008).
 *
 * Non streaming with a loading state (Task 5 choice, stated in the PR):
 * streaming three providers through one abstraction with per provider SSE
 * parsing added real complexity for a support chat where replies are short, so
 * the pane shows a thinking indicator and renders the reply when it lands.
 */

const MESSAGE_MAX = 8000
/** How many prior turns to send the provider. Support chats are short; this
 * caps token cost and latency on a long conversation. */
const HISTORY_LIMIT = 40

export class ChatInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ChatInputError'
  }
}

export class ChatRateLimitError extends Error {
  readonly retryAfterMs: number
  constructor(retryAfterMs: number) {
    super('You are sending messages very quickly. Give it a moment and try again.')
    this.name = 'ChatRateLimitError'
    this.retryAfterMs = retryAfterMs
  }
}

/** The org has no usable key for the chosen (or only) provider. */
export class NoProviderKeyError extends Error {
  constructor() {
    super('The assistant needs an API key. Ask an admin to add one in settings.')
    this.name = 'NoProviderKeyError'
  }
}

/** More than one provider key exists and the caller did not choose one. */
export class ProviderChoiceRequiredError extends Error {
  readonly providers: AiProvider[]
  constructor(providers: AiProvider[]) {
    super('Choose which assistant to use.')
    this.name = 'ProviderChoiceRequiredError'
    this.providers = providers
  }
}

/** The conversation is not the caller's own, does not exist, or was escalated. */
export class ConversationUnavailableError extends Error {
  constructor() {
    super('That conversation is not available.')
    this.name = 'ConversationUnavailableError'
  }
}

export type SendOutcome = {
  conversationId: string
  /** True when this send created the conversation (first message). */
  created: boolean
  assistant: {
    id: string
    content: string
    provider: AiProvider
    model: string
    createdAt: string
  }
}

export async function sendChatMessage(input: {
  conversationId: string | null
  message: string
  provider: string | null
}): Promise<SendOutcome> {
  const message = input.message.trim()
  if (message === '') {
    throw new ChatInputError('Type a message first.')
  }
  if (message.length > MESSAGE_MAX) {
    throw new ChatInputError('That message is very long. Please shorten it.')
  }

  const { userId, orgId: clerkOrgId } = await auth()
  if (!userId || !clerkOrgId) {
    throw new Error('No signed in user or active organization on this session.')
  }

  const rate = checkChatRateLimit(clerkOrgId, userId)
  if (!rate.allowed) {
    throw new ChatRateLimitError(rate.retryAfterMs)
  }

  const { client } = await createOrgScopedClient()

  // Resolve the org uuid the key vault and message rows are keyed by.
  const { data: org, error: orgErr } = await client
    .from('organizations')
    .select('id')
    .eq('clerk_org_id', clerkOrgId)
    .maybeSingle()
  if (orgErr) throw orgErr
  if (!org) throw new OrgNotSyncedError()
  const orgUuid = org.id

  // Which provider. A member with one key needs no choice; with several, the
  // caller must have chosen (the picker); with none, there is nothing to use.
  const { data: providerRows, error: provErr } = await client.rpc(
    'org_api_key_providers',
  )
  if (provErr) throw provErr
  const providers = (providerRows ?? []).filter(isAiProvider)
  let provider: AiProvider
  if (input.provider && isAiProvider(input.provider) && providers.includes(input.provider)) {
    provider = input.provider
  } else if (providers.length === 1) {
    provider = providers[0]
  } else if (providers.length === 0) {
    throw new NoProviderKeyError()
  } else {
    throw new ProviderChoiceRequiredError(providers)
  }

  // Resolve the conversation and gather history under the caller's own RLS.
  // Only the creator may post; an admin who can READ a member's conversation
  // cannot send into it. A NEW conversation is NOT created yet: we create it
  // and persist messages only after a successful reply, so a failed provider
  // call leaves nothing behind (no orphan conversation, and no lone user turn
  // that would break user/assistant alternation on the next request).
  let existingConversationId: string | null = null
  let reopen = false
  let history: ChatTurn[] = []

  if (input.conversationId) {
    const { data: convo, error: cErr } = await client
      .from('chat_conversations')
      .select('id, created_by, status')
      .eq('id', input.conversationId)
      .maybeSingle()
    if (cErr) throw cErr
    if (!convo || convo.created_by !== userId || convo.status === 'escalated') {
      throw new ConversationUnavailableError()
    }
    existingConversationId = convo.id
    reopen = convo.status === 'resolved'

    const { data: past, error: mErr } = await client
      .from('chat_messages')
      .select('role, content')
      .eq('conversation_id', existingConversationId)
      .order('created_at', { ascending: true })
    if (mErr) throw mErr
    history = (past ?? []).map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }))
  }

  const turns: ChatTurn[] = [
    ...history.slice(-HISTORY_LIMIT),
    { role: 'user', content: message },
  ]

  // Read and decrypt the key in request scope, then call the provider. Nothing
  // is written until this succeeds.
  const apiKey = await readProviderKey(orgUuid, provider)
  if (!apiKey) {
    // A key vanished between the provider list and now.
    throw new NoProviderKeyError()
  }

  const reply = await generateReply({
    provider,
    apiKey,
    system: SYSTEM_PROMPT,
    messages: turns,
  })

  const content =
    reply.text.trim() ||
    'Sorry, I could not generate a response just now. Please try again.'

  // Success. Create the conversation now if this is the first message, then
  // persist the user and assistant messages together (service role, since
  // chat_messages is system written). Persisting them as a pair keeps history
  // alternating.
  let conversationId = existingConversationId
  let created = false
  if (!conversationId) {
    const { data: convo, error: cErr } = await client
      .from('chat_conversations')
      .insert({
        org_id: orgUuid,
        created_by: userId,
        title: titleFromMessage(message),
      })
      .select('id')
      .single()
    if (cErr) throw cErr
    conversationId = convo.id
    created = true
  } else if (reopen) {
    // Chatting again on a resolved conversation reopens it.
    await client
      .from('chat_conversations')
      .update({ status: 'open' })
      .eq('id', conversationId)
  }

  const admin = createAdminClient()
  const { error: userMsgErr } = await admin.from('chat_messages').insert({
    org_id: orgUuid,
    conversation_id: conversationId,
    role: 'user',
    content: message,
  })
  if (userMsgErr) throw userMsgErr

  const { data: assistantRow, error: aErr } = await admin
    .from('chat_messages')
    .insert({
      org_id: orgUuid,
      conversation_id: conversationId,
      role: 'assistant',
      content,
      provider,
      model: reply.model,
      input_tokens: reply.inputTokens,
      output_tokens: reply.outputTokens,
    })
    .select('id, created_at')
    .single()
  if (aErr) throw aErr

  return {
    conversationId,
    created,
    assistant: {
      id: assistantRow.id,
      content,
      provider,
      model: reply.model,
      createdAt: assistantRow.created_at,
    },
  }
}
