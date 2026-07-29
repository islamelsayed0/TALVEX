import { AI_PROVIDER_LABELS } from '@/lib/chat/providers-meta'
import type { GroundingCitation } from '@/lib/chat/retrieval'
import type { AiProvider, ChatMessage } from '@/lib/db/types'
import { bubble, bubbleRow, roleLabel } from './chat-style'
import { ArticleCitations } from './citations'

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
  citationsById,
}: {
  messages: ChatMessage[]
  userLabel?: string
  /** Grounding citations per assistant message id, already resolved through
   * THIS viewer's scoped articles read (resolveGroundingCitations). Absent
   * entries render nothing, which is how an article outside the viewer's
   * audience stays traceless. */
  citationsById?: Map<string, GroundingCitation[]>
}) {
  return (
    <div className="flex flex-col gap-3">
      {messages.map((m) => {
        const role = m.role as 'user' | 'assistant'
        const citations = citationsById?.get(m.id)
        return (
          <div key={m.id} className="flex flex-col gap-1">
            <div className={bubbleRow[role]}>
              <div className={bubble[role]}>{m.content}</div>
            </div>
            {role === 'assistant' && citations?.length ? (
              <ArticleCitations citations={citations} />
            ) : null}
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

/**
 * Where "Open full chat" from the popup should land: the specific conversation
 * once one exists this session, otherwise the chat home.
 */
export function fullChatHref(conversationId: string | null): string {
  return conversationId
    ? `/dashboard/chat/${conversationId}`
    : '/dashboard/chat'
}
