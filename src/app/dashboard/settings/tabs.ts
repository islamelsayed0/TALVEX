/**
 * The settings section tabs, in render order. A plain module apart from the
 * client component that renders them (the nav-items.ts pattern), so
 * tests/dashboard-nav.test.ts can pin the set without importing client code.
 */
export const SETTINGS_TABS = [
  { href: '/dashboard/settings/api-keys', label: 'AI providers' },
  { href: '/dashboard/settings/notifications', label: 'Notifications' },
  { href: '/dashboard/settings/status-page', label: 'Status page' },
  { href: '/dashboard/settings/members', label: 'Members' },
  { href: '/dashboard/settings/billing', label: 'Billing' },
  { href: '/dashboard/settings/usage', label: 'Usage' },
  { href: '/dashboard/settings/audit', label: 'Audit' },
]
