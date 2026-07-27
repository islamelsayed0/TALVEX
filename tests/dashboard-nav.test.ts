import { describe, expect, it } from 'vitest'

import {
  ADMIN_NAV,
  MEMBER_NAV,
  isNavItemActive,
  navFor,
} from '../src/app/dashboard/nav-items'

// The redesign makes the header nav role aware: admins get the operations nav,
// members get a two item Help nav. The redirect that enforces this lives in
// requireAdmin (org-viewer.ts) and runs against Clerk and the database, which
// CI cannot exercise; this suite tests the rule the UI reads, which is the part
// that can silently rot. It mirrors the tests/auth-routes.test.ts approach.

describe('role aware nav', () => {
  it('gives admins the full operations nav in order', () => {
    expect(navFor(true)).toBe(ADMIN_NAV)
    expect(ADMIN_NAV.map((i) => i.label)).toEqual([
      'Overview',
      'Monitors',
      'Incidents',
      'Tickets',
      'Help',
    ])
  })

  it('gives members only Home and My requests', () => {
    expect(navFor(false)).toBe(MEMBER_NAV)
    expect(MEMBER_NAV.map((i) => i.label)).toEqual(['Home', 'My requests'])
  })

  it('never offers a member an admin only route', () => {
    const memberHrefs = MEMBER_NAV.map((i) => i.href)
    for (const adminOnly of [
      '/dashboard',
      '/dashboard/monitors',
      '/dashboard/incidents',
      '/dashboard/settings/api-keys',
    ]) {
      expect(memberHrefs).not.toContain(adminOnly)
    }
  })
})

describe('active nav item', () => {
  it('matches Overview only on the exact dashboard root', () => {
    expect(isNavItemActive('/dashboard', '/dashboard', true)).toBe(true)
    expect(isNavItemActive('/dashboard', '/dashboard/monitors', true)).toBe(false)
  })

  it('keeps a section active across its subtree', () => {
    expect(isNavItemActive('/dashboard/monitors', '/dashboard/monitors')).toBe(
      true,
    )
    expect(
      isNavItemActive('/dashboard/monitors', '/dashboard/monitors/abc123'),
    ).toBe(true)
  })

  it('does not light up on a sibling that merely shares a prefix', () => {
    expect(
      isNavItemActive('/dashboard/monitors', '/dashboard/monitors-archive'),
    ).toBe(false)
  })
})
