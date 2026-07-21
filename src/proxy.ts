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
