'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * The settings section tabs. The gear in the header lands on AI providers;
 * this nav is how the other settings surfaces are reached. Rendered by each
 * settings page under its heading, admin only by virtue of the pages
 * themselves (requireAdmin).
 */

const TABS = [
  { href: '/dashboard/settings/api-keys', label: 'AI providers' },
  { href: '/dashboard/settings/notifications', label: 'Notifications' },
  { href: '/dashboard/settings/status-page', label: 'Status page' },
  { href: '/dashboard/settings/members', label: 'Members' },
  { href: '/dashboard/settings/usage', label: 'Usage' },
  { href: '/dashboard/settings/audit', label: 'Audit' },
]

export function SettingsNav() {
  const pathname = usePathname()
  return (
    <nav aria-label="Settings sections" className="mb-[18px] flex gap-2">
      {TABS.map((tab) => {
        const active = pathname.startsWith(tab.href)
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={`rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors duration-150 ${
              active
                ? 'border-(--toggle-border) bg-(--ghost-hover-bg) text-foreground'
                : 'border-transparent text-muted-foreground hover:bg-(--ghost-hover-bg) hover:text-foreground'
            }`}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
