import Link from 'next/link'
import { notFound } from 'next/navigation'

import { UNKNOWN_MEMBER, resolveUserNames } from '@/lib/auth/user-names'
import { listKeyProviders } from '@/lib/db/api-keys'
import { getChatViewer, getConversation, listMessages } from '@/lib/db/chat'
import { getTicketForConversation } from '@/lib/db/tickets'
import type { ChatConversationStatus, TicketStatus } from '@/lib/db/types'
import { ghostButton } from '../../monitors/ui'
import { TicketStatusBadge } from '../../tickets/ui'
import {
  escalateConversationAction,
  markConversationResolvedAction,
} from '../actions'
import { ChatPane } from '../chat-pane'
import { DisclosureLine, Transcript, toProviderOptions } from '../ui'

export const metadata = { title: 'Conversation — Talvex' }

const STATUS_LABEL: Record<ChatConversationStatus, string> = {
  open: 'Open',
  resolved: 'Resolved',
  escalated: 'Sent to IT team',
}

/**
 * One conversation. A conversation this session cannot see 404s exactly like
 * one that does not exist (RLS returns no row either way). What renders depends
 * on who is looking and the conversation's state:
 *   - The creator, still active: the interactive pane, plus the persistent
 *     calm actions (send to IT team, mark solved).
 *   - Anyone (creator or admin) on an escalated conversation: a read only
 *     transcript and the "your IT team has this now" card with the ticket link.
 *   - An admin reading a member's active conversation: a read only transcript;
 *     admins read (workplace records ruling) but do not post into it.
 */
export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const conversation = await getConversation(id)
  if (!conversation) notFound()

  const [viewer, messages] = await Promise.all([
    getChatViewer(),
    listMessages(id),
  ])
  const status = conversation.status as ChatConversationStatus
  const isCreator = conversation.created_by === viewer.userId
  const escalated = status === 'escalated'

  const paneMessages = messages.map((m) => ({
    id: m.id,
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }))

  return (
    <main className="flex flex-1 flex-col gap-5 p-8">
      <div>
        <Link href="/dashboard/chat" className="text-xs text-link hover:text-foreground">
          ← All conversations
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-title text-foreground">{conversation.title}</h1>
          <span className="text-xs text-quiet">{STATUS_LABEL[status]}</span>
        </div>
        <div className="mt-1.5">
          <DisclosureLine />
        </div>
      </div>

      {escalated ? (
        <EscalatedNotice conversationId={id} />
      ) : isCreator ? (
        <ConversationActions conversationId={id} status={status} />
      ) : null}

      <div className="flex max-w-2xl flex-1 flex-col">
        {isCreator && !escalated ? (
          <ChatPane
            conversationId={id}
            initialMessages={paneMessages}
            providers={toProviderOptions(await listKeyProviders())}
          />
        ) : (
          <Transcript
            messages={messages}
            userLabel={
              isCreator
                ? 'You'
                : ((await resolveUserNames([conversation.created_by])).get(
                    conversation.created_by,
                  ) ?? UNKNOWN_MEMBER)
            }
          />
        )}
      </div>
    </main>
  )
}

/**
 * The persistent calm actions on an active conversation (addendum): send this
 * to the IT team (opens the prefilled ticket form), and mark it solved. Both
 * are server action forms; the assistant never escalates itself.
 */
function ConversationActions({
  conversationId,
  status,
}: {
  conversationId: string
  status: ChatConversationStatus
}) {
  return (
    <div className="flex max-w-2xl flex-wrap items-center gap-3">
      <form action={escalateConversationAction}>
        <input type="hidden" name="conversation_id" value={conversationId} />
        <button type="submit" className={ghostButton}>
          Send this to your IT team
        </button>
      </form>
      {status !== 'resolved' ? (
        <form action={markConversationResolvedAction}>
          <input type="hidden" name="conversation_id" value={conversationId} />
          <button type="submit" className={ghostButton}>
            Mark as solved
          </button>
        </form>
      ) : null}
    </div>
  )
}

/**
 * After escalation: "your IT team has this now", with the ticket link. The AI
 * summary lives in the ticket body; the full transcript is one click away on
 * the ticket's reference card, since admins can read conversations.
 */
async function EscalatedNotice({ conversationId }: { conversationId: string }) {
  const ticket = await getTicketForConversation(conversationId)
  return (
    <section className="max-w-2xl rounded-button border border-border bg-card p-6">
      <h2 className="text-base font-semibold text-foreground">
        Your IT team has this now
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        This conversation was sent to your team as a ticket. You can follow it
        there.
      </p>
      {ticket ? (
        <Link
          href={`/dashboard/tickets/${ticket.id}`}
          className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-button border border-border bg-card px-5 py-4 transition-colors hover:border-(--ghost-border-hover)"
        >
          <span className="text-sm font-medium text-card-foreground">
            {ticket.title}
          </span>
          <TicketStatusBadge status={ticket.status as TicketStatus} />
        </Link>
      ) : null}
    </section>
  )
}
