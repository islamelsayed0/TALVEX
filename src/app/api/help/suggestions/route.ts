import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

import {
  extractSearchTerms,
  retrieveGroundingArticles,
} from '@/lib/chat/retrieval'
import { createOrgScopedClient, MissingActiveOrgError } from '@/lib/db/client'
import { errorName, logError } from '@/lib/log'
import { createSlidingWindow } from '@/lib/rate-limit'

/**
 * Document suggestions for the ticket form: the grounded retrieval the chat
 * already trusts, pointed at a draft. POST the title and description as
 * typed; get back up to three published documents the caller's tags admit,
 * id and title only.
 *
 * The visibility contract governs (migration 014): retrieval runs on the
 * CALLER scoped client, so RLS admits exactly what this member may read,
 * published documents whose audience tags include them or are empty. No new
 * retrieval engine: the terms, the ranking, and the three document cap are
 * src/lib/chat/retrieval.ts, unchanged.
 *
 * NOTHING about suggestions is logged: not the draft, not the terms, not
 * what came back, not what was clicked. That is analytics and it waits for
 * a privacy ruling. The error path logs the error NAME only.
 *
 * Rate limited per (org, user) like chat sends: a keystroke driven endpoint
 * is a natural runaway loop, and the client's debounce is a courtesy, not a
 * boundary.
 */

const RATE_LIMIT = { max: 30, windowMs: 60_000 } as const
const window_ = createSlidingWindow(RATE_LIMIT)

export async function POST(req: Request): Promise<Response> {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) {
    return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })
  }
  if (!window_.check(`${orgId}:${userId}`).allowed) {
    return NextResponse.json({ error: 'Too many requests.' }, { status: 429 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 })
  }
  const b = body as Record<string, unknown>
  const title = typeof b?.title === 'string' ? b.title : ''
  const description = typeof b?.description === 'string' ? b.description : ''

  const terms = extractSearchTerms(`${title} ${description}`.trim())
  if (terms.length === 0) {
    return NextResponse.json({ suggestions: [] })
  }

  try {
    const { client } = await createOrgScopedClient()
    const articles = await retrieveGroundingArticles(client, terms)
    return NextResponse.json({
      suggestions: articles.map((a) => ({ id: a.id, title: a.title })),
    })
  } catch (err) {
    if (err instanceof MissingActiveOrgError) {
      return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })
    }
    logError('help.suggestions.failed', 'failed', { error: errorName(err) })
    // The strip shows nothing on failure by design; an empty answer keeps
    // the form quiet instead of surfacing an error nobody can act on.
    return NextResponse.json({ suggestions: [] }, { status: 200 })
  }
}
