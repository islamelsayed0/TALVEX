import { NextResponse } from 'next/server'

import { createAnonClient } from '@/lib/db/client'
import { clientIp, createSlidingWindow } from '@/lib/rate-limit'

/**
 * Can this deployment reach its database.
 *
 * One question, one bit of answer. The freshness endpoint next door says
 * whether the sweep is running; this says whether the runtime and Postgres are
 * talking at all, which is the thing Talvext's own monitors check and the thing
 * that distinguishes "the app is down" from "the app is up and the scheduler
 * is not".
 *
 * It reads through the anon client, never the service role. A public
 * unauthenticated route must not hold a client that bypasses RLS, and the
 * service role allowlist in admin.ts stays exactly as written. Under migration
 * 011's policies this select returns rows only for orgs that opted their
 * status page public, and possibly none at all, which is fine: zero rows is a
 * success. What is being distinguished is whether PostgREST and Postgres
 * answered, not what they said.
 *
 * Deliberately absent from the response: version, environment name, commit,
 * timings, which variables are set, and any error text. A health endpoint is a
 * free reconnaissance surface if it is chatty, and none of that helps the one
 * consumer, which is a monitor asking a yes or no question.
 */

export const dynamic = 'force-dynamic'

const window = createSlidingWindow({ max: 60, windowMs: 60_000 })

export async function GET(request: Request) {
  if (!window.check(clientIp(request.headers)).allowed) {
    return NextResponse.json({ error: 'too many requests' }, { status: 429 })
  }

  try {
    const { error } = await createAnonClient()
      .from('organizations')
      .select('id')
      .limit(1)
    if (error) {
      return NextResponse.json({ ok: false }, { status: 503 })
    }
    return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } })
  } catch {
    // Includes the case where the Supabase environment is missing entirely,
    // which is a real deployment failure and should read as unhealthy rather
    // than as a crash.
    return NextResponse.json({ ok: false }, { status: 503 })
  }
}
