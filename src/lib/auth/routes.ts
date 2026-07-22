/**
 * Which routes require a signed in user.
 *
 * This lives apart from proxy.ts on purpose. The proxy module can only run
 * with real Clerk keys, which CI does not have, so the rule itself is kept
 * here as a pure function that tests can exercise directly. proxy.ts holds no
 * second copy of the rule; it calls this.
 */

/** Everything at or below these paths requires a session. /select-org needs
 * a signed in user (it lists their orgs) but deliberately NOT an active org:
 * it is where org-less sessions are sent to get one. */
export const PROTECTED_PREFIXES = ['/dashboard', '/select-org'] as const

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}
