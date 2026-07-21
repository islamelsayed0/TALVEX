import { describe, expect, it } from 'vitest'

import { isProtectedPath } from '../src/lib/auth/routes'

// Task 3 requires proof that /dashboard is closed to signed out users.
//
// The redirect itself is produced by Clerk's auth.protect() inside src/proxy.ts,
// which cannot run without real Clerk keys, and CI has none. So this suite
// tests the rule that decides WHICH routes get protected, which is the part we
// own and the part that can silently rot. That the redirect actually fires is
// verified against a running dev server; see docs/DECISIONS.md.

describe('protected routes', () => {
  it('protects the dashboard and everything under it', () => {
    expect(isProtectedPath('/dashboard')).toBe(true)
    expect(isProtectedPath('/dashboard/')).toBe(true)
    expect(isProtectedPath('/dashboard/monitors')).toBe(true)
    expect(isProtectedPath('/dashboard/monitors/123/edit')).toBe(true)
  })

  it('leaves the public and auth routes open', () => {
    // If any of these ever became protected, sign in would redirect to itself.
    expect(isProtectedPath('/')).toBe(false)
    expect(isProtectedPath('/sign-in')).toBe(false)
    expect(isProtectedPath('/sign-in/factor-one')).toBe(false)
    expect(isProtectedPath('/sign-up')).toBe(false)
    expect(isProtectedPath('/sign-up/verify-email-address')).toBe(false)
  })

  it('does not protect paths that merely start with the same characters', () => {
    // A naive startsWith('/dashboard') would wrongly catch these.
    expect(isProtectedPath('/dashboards')).toBe(false)
    expect(isProtectedPath('/dashboard-public')).toBe(false)
  })
})
