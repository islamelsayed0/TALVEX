import Link from 'next/link'

import { UNKNOWN_MEMBER, resolveUserNames } from '@/lib/auth/user-names'
import { orgHasKey } from '@/lib/db/api-keys'
import { getChatViewer, listConversations } from '@/lib/db/chat'
import type { ChatConversationStatus } from '@/lib/db/types'
import { formatUtc, primaryButton } from '../monitors/ui'
import { DisclosureLine } from './ui'

export const metadata = { title: 'Chat — Talvex' }

const STATUS_LABEL: Record<ChatConversationStatus, string> = {
  open: 'Open',
  resolved: 'Resolved',
  escalated: 'Sent to IT team',
}

/**
 * The chat home: past conversations, and the way into a new one. The funnel
 * begins at Get help (the addendum), but the pane stays reachable here so
 * people can return to earlier conversations. A member sees their own; an org
 * admin sees the whole org (workplace records ruling), so admins get the
 * creator's name on each row.
 */
export default async function ChatPage() {
  const [viewer, hasKey, conversations] = await Promise.all([
    getChatViewer(),
    orgHasKey(),
    listConversations(),
  ])

  const names = viewer.isAdmin
    ? await resolveUserNames(conversations.map((c) => c.created_by))
    : new Map<string, string>()

  return (
    <main className="flex flex-1 flex-col gap-6 p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-title text-foreground">Chat</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {viewer.isAdmin
              ? 'Every conversation in your organization.'
              : 'Your conversations with the assistant.'}
          </p>
          <div className="mt-1.5">
            <DisclosureLine />
          </div>
        </div>
        {hasKey ? (
          <Link href="/dashboard/chat/new" className={primaryButton}>
            New conversation
          </Link>
        ) : null}
      </div>

      {!hasKey ? (
        <section className="max-w-2xl rounded-button border border-border bg-card p-6">
          <h2 className="text-base font-semibold text-foreground">
            The assistant needs an API key
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Chat runs on an AI provider key your organization brings. Once an
            admin adds one, the assistant is ready to use.
          </p>
          {viewer.isAdmin ? (
            <Link
              href="/dashboard/settings/api-keys"
              className="mt-3 inline-block text-sm text-accent-text hover:underline"
            >
              Add a key in settings
            </Link>
          ) : (
            <p className="mt-3 text-sm text-quiet">Ask an admin to add one.</p>
          )}
        </section>
      ) : null}

      {conversations.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No conversations yet.
        </p>
      ) : (
        <ul className="flex max-w-2xl flex-col gap-2">
          {conversations.map((c) => (
            <li key={c.id}>
              <Link
                href={`/dashboard/chat/${c.id}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-button border border-border bg-card px-5 py-4 transition-colors hover:border-(--ghost-border-hover)"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium text-card-foreground">
                    {c.title}
                  </span>
                  <span className="text-xs text-quiet">
                    {viewer.isAdmin
                      ? `${names.get(c.created_by) ?? UNKNOWN_MEMBER} · ${formatUtc(c.updated_at)}`
                      : formatUtc(c.updated_at)}
                  </span>
                </div>
                <span className="shrink-0 text-xs text-quiet">
                  {STATUS_LABEL[c.status as ChatConversationStatus]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
