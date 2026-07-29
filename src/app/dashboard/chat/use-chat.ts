'use client'

import { useState } from 'react'

import type { GroundingCitation } from '@/lib/chat/retrieval'
import type { AiProvider, ChatRole } from '@/lib/db/types'
import type { ProviderOption } from './ui'

/**
 * The chat send flow, shared by the full chat pane (chat-pane.tsx) and the
 * floating popup (ask-talvex-widget.tsx) so both behave identically: optimistic
 * user bubble, POST to /api/chat (non streaming), typed error to a calm line,
 * and the assistant reply appended when it lands. Message writes and the
 * provider call happen server side; this only reflects them.
 *
 * `syncUrl` updates the address bar to the conversation url on the first send
 * (true on the full page, so a refresh keeps the thread; false in the popup,
 * which must not hijack the url of whatever screen you are on). The conversation
 * is the same model either way, so a popup chat still shows up in the full
 * chat history.
 */

export type PaneMessage = {
  id: string
  role: ChatRole
  content: string
  /** Knowledge base articles this assistant reply drew from, already scoped
   * to what this viewer may read. Absent on user turns and ungrounded
   * replies. */
  citations?: GroundingCitation[]
}

export function useChat({
  conversationId: initialConversationId,
  initialMessages,
  providers,
  syncUrl = false,
}: {
  conversationId: string | null
  initialMessages: PaneMessage[]
  providers: ProviderOption[]
  syncUrl?: boolean
}) {
  const [messages, setMessages] = useState<PaneMessage[]>(initialMessages)
  const [conversationId, setConversationId] = useState<string | null>(
    initialConversationId,
  )
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [provider, setProvider] = useState<AiProvider>(
    providers[0]?.value ?? ('anthropic' as AiProvider),
  )

  async function send() {
    const text = input.trim()
    if (text === '' || sending) return
    setError(null)

    const optimistic: PaneMessage = {
      id: `local-${Date.now()}`,
      role: 'user',
      content: text,
    }
    setMessages((m) => [...m, optimistic])
    setInput('')
    setSending(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          message: text,
          provider: providers.length > 1 ? provider : null,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error ?? 'Something went wrong. Please try again.')
        return
      }
      // A new conversation: keep the state, only sync the url on the full page.
      if (!conversationId && typeof data.conversationId === 'string') {
        setConversationId(data.conversationId)
        if (syncUrl) {
          window.history.replaceState(
            null,
            '',
            `/dashboard/chat/${data.conversationId}`,
          )
        }
      }
      setMessages((m) => [
        ...m,
        {
          id: data.assistant.id,
          role: 'assistant',
          content: data.assistant.content,
          citations: Array.isArray(data.assistant.citations)
            ? data.assistant.citations
            : undefined,
        },
      ])
    } catch {
      setError(
        'Could not reach the assistant. Check your connection and try again.',
      )
    } finally {
      setSending(false)
    }
  }

  return {
    messages,
    conversationId,
    input,
    setInput,
    sending,
    error,
    provider,
    setProvider,
    send,
  }
}
