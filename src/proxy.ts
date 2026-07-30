import { clerkMiddleware } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

import { isProtectedPath } from '@/lib/auth/routes'
import { clientIp, createSlidingWindow } from '@/lib/rate-limit'

/**
 * Next 16 renamed the middleware file convention to proxy. Using middleware.ts
 * still works but logs a deprecation warning on every build, and having both
 * files is a hard error. Clerk 7 supports either name; it detects Next 16 and
 * refers to "middleware or proxy" in its own errors.
 *
 * auth.protect() redirects signed out users to the sign in page rather than
 * returning a 404, which is the behaviour Task 3 asks us to prove.
 *
 * That holds on localhost and on a Clerk production instance. It does NOT hold
 * on a deployed Clerk development instance, which is what Phase 0 ships: with
 * no dev browser token present, Clerk rewrites to 404 instead of redirecting
 * (response header `x-clerk-auth-reason: protect-rewrite, dev-browser-missing`).
 * Do not chase that 404 as a routing bug; see docs/DECISIONS.md. It disappears
 * when the app moves to a production instance on an owned domain.
 */
/**
 * The public status page limit (BRD S4), here rather than inside the route.
 *
 * /status/[slug] is ISR with revalidate = 60, and that CDN cache is the actual
 * protection: most traffic never reaches a function at all. Reading request
 * headers inside the route to limit it would opt the page out of static
 * rendering and destroy the very thing doing the work. The proxy runs ahead of
 * the cache and can refuse without changing how the page renders.
 *
 * Sixty a minute per IP is far above a human reading a status page during an
 * outage, and far below a scraper.
 */
const statusPageWindow = createSlidingWindow({ max: 60, windowMs: 60_000 })

export default clerkMiddleware(async (auth, request) => {
  if (request.nextUrl.pathname.startsWith('/status/')) {
    try {
      if (!statusPageWindow.check(clientIp(request.headers)).allowed) {
        return new NextResponse('Too many requests', { status: 429 })
      }
    } catch {
      // Fails open on purpose. A bug in the limiter must never be the reason a
      // customer cannot see whether their systems are up; that page is the one
      // thing that has to work when everything else is broken.
    }
  }

  if (isProtectedPath(request.nextUrl.pathname)) {
    await auth.protect()
  }
})

export const config = {
  matcher: [
    // Everything except Next internals, static files (unless a search
    // param is present, so server actions on static-ish routes still run),
    // and the cron routes. Cron invocations carry no user session and
    // authenticate with the CRON_SECRET bearer token inside the route
    // (architecture ruling, Phase 1 Task 1), so Clerk middleware has
    // nothing to add there.
    '/((?!_next|api/cron|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes, except the cron routes (same reason).
    '/(api(?!/cron)|trpc)(.*)',
  ],
}
