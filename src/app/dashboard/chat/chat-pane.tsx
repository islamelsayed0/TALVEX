'use client'

import { useRef, useState } from 'react'

import type { AiProvider, ChatRole } from '@/lib/db/types'
import { bubble, bubbleRow, roleLabel } from './chat-style'

/**
 * The interactive chat pane (client component: interactivity requires it,
 * CLAUDE.md rule 6). It renders the thread, sends to /api/chat, and shows a
 * thinking indicator while the reply is on its way (non streaming). Message
 * writes and the provider call happen server side; this only reflects them.
 *
 * When a send creates a new conversation, the pane updates the address bar to
 * the conversation url WITHOUT navigating, so its state survives (a router
 * navigation would remount and lose the thread).
 */

type PaneMessage = { id: string; role: ChatRole; content: string }

type ProviderOption = { value: AiProvider; label: string }

const primaryButton =
  'inline-flex items-center justify-center rounded-button bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60'

const fieldClass =
  'w-full rounded-field border border-input bg-field px-4 py-3 text-sm leading-relaxed text-field-text outline-none transition-colors placeholder:text-placeholder focus:border-(--ring) focus:bg-field-focus'

export function ChatPane({
  conversationId: initialConversationId,
  initialMessages,
  providers,
}: {
  conversationId: string | null
  initialMessages: PaneMessage[]
  providers: ProviderOption[]
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
  const endRef = useRef<HTMLDivElement>(null)

  const scrollToEnd = () => {
    requestAnimationFrame(() =>
      endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }),
    )
  }

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
    scrollToEnd()

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
      // A new conversation: keep the pane, just update the url.
      if (!conversationId && typeof data.conversationId === 'string') {
        setConversationId(data.conversationId)
        window.history.replaceState(null, '', `/dashboard/chat/${data.conversationId}`)
      }
      setMessages((m) => [
        ...m,
        { id: data.assistant.id, role: 'assistant', content: data.assistant.content },
      ])
    } catch {
      setError('Could not reach the assistant. Check your connection and try again.')
    } finally {
      setSending(false)
      scrollToEnd()
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-col gap-3">
        {messages.length === 0 ? (
          <div className={bubbleRow.assistant}>
            <div className={bubble.assistant}>
              Hi, I am the Talvex assistant. Tell me what you need help with and I
              will do my best. If I cannot sort it out, I can help you send it to
              your IT team.
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className="flex flex-col gap-1">
              <div className={bubbleRow[m.role]}>
                <div className={bubble[m.role]}>{m.content}</div>
              </div>
              <span
                className={`px-1 text-xs text-quiet ${
                  m.role === 'user' ? 'text-right' : 'text-left'
                }`}
              >
                {roleLabel[m.role]}
              </span>
            </div>
          ))
        )}

        {sending ? (
          <div className={bubbleRow.assistant}>
            <div className={`${bubble.assistant} text-muted-foreground`}>
              Thinking…
            </div>
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-field border border-(--status-down) px-4 py-3 text-sm text-status-down"
        >
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        {providers.length > 1 ? (
          <label className="flex items-center gap-2 text-xs text-quiet">
            Assistant
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as AiProvider)}
              className="rounded-field border border-input bg-field px-2 py-1 text-xs text-field-text outline-none focus:border-(--ring)"
            >
              {providers.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            maxLength={8000}
            placeholder="Type your question. Enter to send, Shift+Enter for a new line."
            className={`${fieldClass} resize-y`}
            disabled={sending}
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={sending || input.trim() === ''}
            className={primaryButton}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
