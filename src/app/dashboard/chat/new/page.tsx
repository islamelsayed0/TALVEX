import Link from 'next/link'
import { redirect } from 'next/navigation'

import { listKeyProviders } from '@/lib/db/api-keys'
import { ChatPane } from '../chat-pane'
import { DisclosureLine, toProviderOptions } from '../ui'

export const metadata = { title: 'New conversation — Talvex' }

/**
 * A fresh conversation. It exists only in the pane until the first message is
 * sent; the server creates the conversation row then and the pane updates the
 * url. Without a key there is nothing to talk to, so we send the person back to
 * the chat home, which explains why.
 */
export default async function NewChatPage() {
  const providers = await listKeyProviders()
  if (providers.length === 0) {
    redirect('/dashboard/chat')
  }

  return (
    <main className="flex flex-1 flex-col gap-5 p-8">
      <div>
        <Link href="/dashboard/chat" className="text-xs text-link hover:text-foreground">
          ← All conversations
        </Link>
        <h1 className="mt-2 text-title text-foreground">New conversation</h1>
        <div className="mt-1.5">
          <DisclosureLine />
        </div>
      </div>

      <div className="flex max-w-2xl flex-1 flex-col">
        <ChatPane
          conversationId={null}
          initialMessages={[]}
          providers={toProviderOptions(providers)}
        />
      </div>
    </main>
  )
}
