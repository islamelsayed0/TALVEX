'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * The floating AI entry point, fixed bottom right. Shown on every admin screen
 * except Help itself (you are already there), so it hides on /dashboard/help*.
 * The layout renders it for admins only. Accent tinted glass: the AI action is
 * an accent affordance, which is why it carries the one blue.
 */
export function AskTalvexPill() {
  const pathname = usePathname()
  if (pathname === '/dashboard/help' || pathname.startsWith('/dashboard/help/')) {
    return null
  }

  return (
    <Link
      href="/dashboard/help"
      className="glass fixed right-6 bottom-6 z-50 flex items-center gap-2.5 rounded-full bg-(--accent-hover-bg) px-[19px] py-[13px] text-sm font-semibold text-accent-text transition-transform duration-150 hover:-translate-y-0.5"
    >
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 3l1.5 5.1L18.5 9.5 13.5 11 12 16l-1.5-5L5.5 9.5 10.5 8.1z" />
        <path d="M18.5 15.5l.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7z" />
      </svg>
      Ask Talvex
    </Link>
  )
}
