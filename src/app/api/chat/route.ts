import { NextResponse } from 'next/server'

import {
  ChatInputError,
  ChatRateLimitError,
  ConversationUnavailableError,
  NoProviderKeyError,
  ProviderChoiceRequiredError,
  sendChatMessage,
} from '@/lib/chat/engine'
import { ProviderError } from '@/lib/chat/providers'

/**
 * The chat send endpoint (Task 5). POST a message; get back the assistant
 * reply. The whole provider call, key decryption, and message persistence
 * happen server side in the engine; this route only parses input, calls it, and
 * maps typed failures to statuses. Clerk middleware authenticates the request
 * (the /api matcher covers it), so the engine has a signed in user.
 *
 * Non streaming (engine choice, stated in the PR): the client shows a thinking
 * indicator and renders the reply when it lands.
 */
export async function POST(req: Request): Promise<Response> {
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
    // Log only the error NAME: never the message, which could carry context we
    // have not vetted for key material (ruling 4).
    console.error('[chat] send failed:', err instanceof Error ? err.name : 'unknown')
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 },
    )
  }
}
