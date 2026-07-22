import { clerkMiddleware } from '@clerk/nextjs/server'

import { isProtectedPath } from '@/lib/auth/routes'

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
export default clerkMiddleware(async (auth, request) => {
  if (isProtectedPath(request.nextUrl.pathname)) {
    await auth.protect()
  }
})

export const config = {
  matcher: [
    // Everything except Next internals and static files, unless a search
    // param is present, so server actions on static-ish routes still run.
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes.
    '/(api|trpc)(.*)',
  ],
}
