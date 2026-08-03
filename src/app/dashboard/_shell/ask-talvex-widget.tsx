'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useId, useRef, useState } from 'react'

import { bubble, bubbleRow } from '../chat/chat-style'
import { ArticleCitations } from '../chat/citations'
import { DisclosureLine, fullChatHref, type ProviderOption } from '../chat/ui'
import { useChat } from '../chat/use-chat'

/**
 * The floating AI entry point, fixed bottom right. The trigger is the accent
 * glass pill; clicking it opens a compact chat popup in place, so anyone can ask
 * the assistant from any screen without leaving it. It reuses the full chat
 * backend (/api/chat) and message styling; the conversation is the same model,
 * so a popup chat also shows up in the full chat history.
 *
 * Rendered for everyone by the layout. Hidden on Help itself (that page is its
 * own ask entry). When the org has no provider key, the panel explains that
 * instead of taking input.
 */
export function AskTalvexWidget({
  hasKey,
  isAdmin,
  providers,
}: {
  hasKey: boolean
  isAdmin: boolean
  providers: ProviderOption[]
}) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const endRef = useRef<HTMLDivElement>(null)

  const {
    messages,
    conversationId,
    input,
    setInput,
    sending,
    error,
    provider,
    setProvider,
    send,
  } = useChat({
    conversationId: null,
    initialMessages: [],
    providers,
    syncUrl: false,
  })

  useEffect(() => {
    if (open && hasKey) inputRef.current?.focus()
  }, [open, hasKey])

  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() =>
      endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }),
    )
  }, [messages, sending, open])

  /*
   * Escape closes the panel, from anywhere on the page.
   *
   * This used to be an onKeyDown on the wrapper div, which only fired when
   * focus was already inside the widget. A dialog is expected to answer Escape
   * regardless, and a keyboard user who tabbed out to the page behind it had no
   * way to dismiss this one. A document listener, mounted only while open, is
   * both the accessible behaviour and what stops jsx-a11y flagging a static
   * element carrying an interaction.
   */
  useEffect(() => {
    if (!open) return
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onEscape)
    return () => document.removeEventListener('keydown', onEscape)
  }, [open])

  // Hidden on Help, which is its own ask entry.
  if (pathname === '/dashboard/help' || pathname.startsWith('/dashboard/help/')) {
    return null
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }


  return (
    <div className="fixed right-6 bottom-6 z-50 flex flex-col items-end gap-3">
      {open ? (
        <section
          id={panelId}
          role="dialog"
          aria-label="Talvex AI assistant"
          className="flex h-[min(70vh,560px)] w-[min(380px,calc(100vw-3rem))] flex-col overflow-hidden rounded-card border border-card-border bg-card shadow-card"
        >
          {/* Header */}
          <header className="flex items-center justify-between gap-3 border-b border-divider px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">
                Talvex AI
              </span>
              <Link
                href={fullChatHref(conversationId)}
                className="text-xs text-accent-text hover:underline"
              >
                Open full chat ↗
              </Link>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close assistant"
              className="rounded-mini p-1 text-quiet transition-colors hover:text-foreground"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </header>

          {hasKey ? (
            <>
              {/* Thread */}
              <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
                <DisclosureLine />
                {messages.length === 0 ? (
                  <div className={bubbleRow.assistant}>
                    <div className={bubble.assistant}>
                      Hi, I am the Talvex assistant. Tell me what you need help
                      with. If I cannot sort it out, I can help you send it to
                      your IT team.
                    </div>
                  </div>
                ) : (
                  messages.map((m) => (
                    <div key={m.id} className="flex flex-col gap-1">
                      <div className={bubbleRow[m.role]}>
                        <div className={bubble[m.role]}>{m.content}</div>
                      </div>
                      {m.role === 'assistant' && m.citations?.length ? (
                        <ArticleCitations citations={m.citations} />
                      ) : null}
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

              {/* Composer */}
              <div className="flex flex-col gap-2 border-t border-divider px-4 py-3">
                {error ? (
                  <p role="alert" className="text-xs text-status-down">
                    {error}
                  </p>
                ) : null}
                {providers.length > 1 ? (
                  <label className="flex items-center gap-2 text-xs text-quiet">
                    Assistant
                    <select
                      value={provider}
                      onChange={(e) =>
                        setProvider(e.target.value as typeof provider)
                      }
                      className="rounded-field border border-input bg-field px-2 py-1 text-xs text-field-text focus:border-(--ring)"
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
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={onKeyDown}
                    rows={1}
                    maxLength={8000}
                    placeholder="Ask a question…"
                    className="max-h-28 min-h-[42px] w-full resize-y rounded-field border border-input bg-field px-3 py-2.5 text-sm leading-relaxed text-field-text transition-colors placeholder:text-placeholder focus:border-(--ring) focus:bg-field-focus"
                    disabled={sending}
                  />
                  <button
                    type="button"
                    onClick={() => void send()}
                    disabled={sending || input.trim() === ''}
                    className="inline-flex items-center justify-center rounded-button bg-primary px-3.5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
                  >
                    Send
                  </button>
                </div>
              </div>
            </>
          ) : (
            /* No provider key: explain instead of taking input. */
            <div className="flex flex-1 flex-col gap-3 px-5 py-6">
              <h2 className="text-sm font-semibold text-foreground">
                The assistant needs an API key
              </h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Chat runs on an AI provider key your organization connects. Once
                one is added, the assistant is ready.
              </p>
              {isAdmin ? (
                <Link
                  href="/dashboard/settings/api-keys"
                  className="text-sm text-accent-text hover:underline"
                >
                  Add a key in settings
                </Link>
              ) : (
                <p className="text-sm text-quiet">Ask an admin to add one.</p>
              )}
            </div>
          )}
        </section>
      ) : null}

      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="glass-accent flex items-center gap-2.5 rounded-full px-[19px] py-[13px] text-sm font-semibold text-accent-text transition-transform duration-150 hover:-translate-y-0.5"
      >
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 3l1.5 5.1L18.5 9.5 13.5 11 12 16l-1.5-5L5.5 9.5 10.5 8.1z" />
          <path d="M18.5 15.5l.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7z" />
        </svg>
        Ask Talvex
      </button>
    </div>
  )
}
