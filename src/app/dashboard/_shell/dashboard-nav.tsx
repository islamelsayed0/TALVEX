'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { isNavItemActive, type NavItem } from '../nav-items'

/**
 * The center glass nav pill. Client only for the active state, which follows
 * the current route. The pill is neutral chrome (the .glass class); the active
 * item lifts with a quiet inset highlight (the .nav-item rules in globals.css,
 * which carry both themes).
 */
export function DashboardNav({ items }: { items: readonly NavItem[] }) {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Primary"
      className="glass flex flex-none items-center gap-0.5 rounded-full p-1"
    >
      {items.map((item) => {
        const active = isNavItemActive(item.href, pathname, item.exact)
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className="nav-item rounded-full px-[15px] py-[7px] text-[13.5px] font-medium whitespace-nowrap transition-colors duration-150"
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
