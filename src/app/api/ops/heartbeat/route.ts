import { NextResponse } from 'next/server'

import { readPublicSweepFreshness } from '@/lib/db/heartbeat'
import { buildHeartbeatPayload } from '@/lib/monitoring/heartbeat'
import { clientIp, createSlidingWindow } from '@/lib/rate-limit'

/**
 * Is the sweep alive, answerable from outside the deployment.
 *
 * The problem this solves is a circular one. If the sweep dies it cannot email
 * anyone, because the sweep is the thing that sends email. The dashboard
 * banner added with the heartbeat is real but passive: it only fires when a
 * human happens to look. And self monitoring does not help either, because
 * Talvex's own monitors are checked by the same dead sweep and would sit there
 * showing stale green. Only something outside the deployment can notice, and
 * something outside the deployment needs something to poll.
 *
 * Status code carries the answer: 200 when fresh, 503 when stale. The watcher
 * is a curl with --fail, so it needs no JSON parsing to go red, and anything
 * else that speaks HTTP can consume it too.
 *
 * WHY THIS IS UNAUTHENTICATED. The obvious alternative is to require
 * CRON_SECRET and put a copy in GitHub secrets. That is rejected, and the
 * reason is the root cause of the outage this whole effort exists for: the
 * secret already lives in two places that must agree, Vercel and the external
 * scheduler, and they drifted, which is how monitoring stopped. A third copy
 * makes the next rotation a three way problem and makes the same failure more
 * likely, not less. What is disclosed here is when this platform's own sweep
 * last ran. No tenant is named, no count is exposed, and nothing is writable.
 * The anon column grant in migration 018 enforces the second of those, not
 * this handler, so the payload cannot quietly grow a field later.
 */

export const dynamic = 'force-dynamic'

// Generous: a watcher polls this twice an hour. The limit exists so a public
// unauthenticated route cannot be used to hammer PostgREST.
const window = createSlidingWindow({ max: 30, windowMs: 60_000 })

export async function GET(request: Request) {
  if (!window.check(clientIp(request.headers)).allowed) {
    return NextResponse.json({ error: 'too many requests' }, { status: 429 })
  }

  const payload = buildHeartbeatPayload(await readPublicSweepFreshness())

  // A heartbeat we cannot read is not evidence the sweep is running, so an
  // unreadable row reports stale rather than optimistically healthy.
  return NextResponse.json(payload, {
    status: payload.stale ? 503 : 200,
    // Never cached. A cached liveness answer is a lie with a timestamp.
    headers: { 'cache-control': 'no-store' },
  })
}
