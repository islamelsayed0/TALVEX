import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

import {
  ChatInputError,
  ChatRateLimitError,
  ConversationUnavailableError,
  NoProviderKeyError,
  ProviderChoiceRequiredError,
  sendChatMessage,
} from '@/lib/chat/engine'
import { EncryptionKeyError, KeyDecryptionError } from '@/lib/chat/encryption'
import { ProviderError } from '@/lib/chat/providers'
import { errorName, logError } from '@/lib/log'
import { AdminConfigError } from '@/lib/db/admin'

/**
 * The chat send endpoint (Task 5). POST a message; get back the assistant
 * reply. The whole provider call, key decryption, and message persistence
 * happen server side in the engine; this route only parses input, calls it, and
 * maps typed failures to statuses.
 *
 * Authentication is checked HERE, explicitly (audit M3). The Clerk middleware
 * matcher makes clerkMiddleware run on /api routes but auth.protect() fires
 * only for the dashboard prefixes, so a route under /api must gate itself; an
 * unauthenticated caller gets a typed 401, never a parse or an engine crash.
 *
 * Non streaming (engine choice, stated in the PR): the client shows a thinking
 * indicator and renders the reply when it lands.
 */
export async function POST(req: Request): Promise<Response> {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) {
    return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 })
  }
  const b = body as Record<string, unknown>
  const conversationId = typeof b?.conversationId === 'string' ? b.conversationId : null
  const message = typeof b?.message === 'string' ? b.message : ''
  const provider = typeof b?.provider === 'string' ? b.provider : null

  try {
    const outcome = await sendChatMessage({ conversationId, message, provider })
    return NextResponse.json(outcome)
  } catch (err) {
    if (err instanceof ChatInputError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    if (err instanceof ChatRateLimitError) {
      return NextResponse.json({ error: err.message }, { status: 429 })
    }
    if (err instanceof ProviderChoiceRequiredError) {
      return NextResponse.json(
        { error: err.message, providers: err.providers },
        { status: 409 },
      )
    }
    if (err instanceof NoProviderKeyError) {
      return NextResponse.json({ error: err.message }, { status: 409 })
    }
    if (err instanceof ConversationUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    if (err instanceof ProviderError) {
      // The admin grade remediation (which names the provider and billing) is
      // not for a member. Give a calm generic line and point at the team.
      return NextResponse.json(
        {
          error:
            'The assistant could not reach the provider just now. Your IT team can check the key, or you can send this to them.',
        },
        { status: 502 },
      )
    }
    // Deployment is missing a server secret (service role key or the encryption
    // secret). This is a configuration gap an admin fixes in the deployment
    // settings, not a user error, so say so plainly rather than "try again".
    if (err instanceof AdminConfigError || err instanceof EncryptionKeyError) {
      return NextResponse.json(
        {
          error:
            'The assistant is not fully set up yet. Your IT team needs to finish the deployment configuration.',
        },
        { status: 503 },
      )
    }
    // The stored key exists but could not be decrypted: a corrupt row, or the
    // encryption secret changed since it was saved. Re adding the key fixes it.
    if (err instanceof KeyDecryptionError) {
      return NextResponse.json(
        {
          error:
            'The saved AI key could not be read. An admin may need to remove it and add it again in settings.',
        },
        { status: 502 },
      )
    }
    // Log only the error NAME: never the message, which could carry context we
    // have not vetted for key material (ruling 4).
    logError('chat.send.failed', 'failed', { error: errorName(err) })
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 },
    )
  }
}
