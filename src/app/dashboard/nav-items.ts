/**
 * The header nav, as data. Pure and free of server or client imports, so the
 * server layout, the client nav pill, and the test all share one definition of
 * what each role sees.
 *
 * The nav pill holds only route destinations. Settings is the gear, and the
 * AI assistant is the floating pill, so neither appears here. Billing is the
 * one deliberate exception to the settings rule: it is a settings tab by
 * route, but money deserves a first class door, so admins also reach it from
 * here (F13 follow up ruling in docs/DECISIONS.md).
 */
export type NavItem = { label: string; href: string; exact?: boolean }

// Overview is exact: without it, every /dashboard/* path would light Overview
// up alongside the real section.
export const ADMIN_NAV: readonly NavItem[] = [
  { label: 'Overview', href: '/dashboard', exact: true },
  { label: 'Monitors', href: '/dashboard/monitors' },
  { label: 'Incidents', href: '/dashboard/incidents' },
  { label: 'Tickets', href: '/dashboard/tickets' },
  { label: 'Documents', href: '/dashboard/articles' },
  { label: 'Inventory', href: '/dashboard/inventory' },
  { label: 'Billing', href: '/dashboard/settings/billing' },
  { label: 'Help', href: '/dashboard/help' },
]

// Members never see Monitors, Incidents, Inventory, the admin Tickets queue,
// or org Settings. Home is the Help front door; My requests is their own
// tickets. Documents is the reading list, the same screen the Get Help door
// opens: the F15 rider puts what a member needs one click from anywhere, and
// two paths to the same place is intended. The label says Documents for both
// roles while the routes differ by role: admins land on management, members
// on reading.
// Home is exact so reading a document (a /dashboard/help subpath) lights
// Documents alone, not both.
export const MEMBER_NAV: readonly NavItem[] = [
  { label: 'Home', href: '/dashboard/help', exact: true },
  { label: 'My requests', href: '/dashboard/tickets' },
  { label: 'Documents', href: '/dashboard/help/articles' },
]

export function navFor(isAdmin: boolean): readonly NavItem[] {
  return isAdmin ? ADMIN_NAV : MEMBER_NAV
}

/** Whether a nav item owns the current path. Non exact items also match their
 * subtree, so a monitor detail keeps Monitors active. */
export function isNavItemActive(
  href: string,
  pathname: string,
  exact = false,
): boolean {
  if (exact) return pathname === href
  return pathname === href || pathname.startsWith(`${href}/`)
}
