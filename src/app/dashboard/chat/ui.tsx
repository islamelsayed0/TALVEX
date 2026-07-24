import { AI_PROVIDER_LABELS } from '@/lib/chat/providers-meta'
import type { AiProvider, ChatMessage } from '@/lib/db/types'
import { bubble, bubbleRow, roleLabel } from './chat-style'

/**
 * Server rendered chat pieces (no client components here). The interactive pane
 * is chat-pane.tsx; this holds the static transcript (for an admin reading a
 * member's conversation, or an escalated conversation that no longer takes
 * input) and the honest disclosure line.
 */

/** The one quiet, honest line the chat surface carries (addendum ruling). */
export function DisclosureLine() {
  return (
    <p className="text-xs text-quiet">Conversations are visible to your IT team.</p>
  )
}

/**
 * A read only rendering of a conversation, oldest first. userLabel names who
 * the user side is: "You" for the creator's own view, the member's name when an
 * admin is reading someone else's conversation.
 */
export function Transcript({
  messages,
  userLabel = roleLabel.user,
}: {
  messages: ChatMessage[]
  userLabel?: string
}) {
  return (
    <div className="flex flex-col gap-3">
      {messages.map((m) => {
        const role = m.role as 'user' | 'assistant'
        return (
          <div key={m.id} className="flex flex-col gap-1">
            <div className={bubbleRow[role]}>
              <div className={bubble[role]}>{m.content}</div>
            </div>
            <span
              className={`px-1 text-xs text-quiet ${
                role === 'user' ? 'text-right' : 'text-left'
              }`}
            >
              {role === 'user' ? userLabel : roleLabel.assistant}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export type ProviderOption = { value: AiProvider; label: string }

export function toProviderOptions(providers: AiProvider[]): ProviderOption[] {
  return providers.map((p) => ({ value: p, label: AI_PROVIDER_LABELS[p] }))
}
