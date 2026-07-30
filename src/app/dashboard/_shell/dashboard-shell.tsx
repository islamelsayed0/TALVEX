'use client'

import { OrganizationSwitcher, UserButton } from '@clerk/nextjs'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'

import { Wordmark } from '@/components/brand/wordmark'

import { isNavItemActive, type NavItem } from '../nav-items'
import type { ProviderOption } from '../chat/ui'
import { AskTalvexWidget } from './ask-talvex-widget'
import { NAV_ICON } from './nav-icons'

/**
 * The dashboard shell: a fixed full height left sidebar and an independently
 * scrolling content area. It replaces the old top bar, relocating the wordmark,
 * the org switcher, the role aware nav, the settings entry, and the UserButton
 * into a vertical rail. Client because the collapse and the narrow overlay are
 * session state (React state in the layout, no database, no localStorage), and
 * the active nav item follows the route. The Ask Talvex pill stays floating over
 * the content, untouched.
 *
 * Visual language is unchanged: the active item keeps the existing .nav-item
 * accent inset treatment, the org switcher keeps its .glass pill, and no new
 * token was needed. Only the frame moved.
 */

const RAIL_OPEN = 'w-[236px]'
const RAIL_COLLAPSED = 'w-[68px]'

function NavRow({
  item,
  label,
  collapsed,
  onNavigate,
}: {
  item: NavItem
  label: string
  collapsed: boolean
  onNavigate?: () => void
}) {
  const pathname = usePathname()
  const active = isNavItemActive(item.href, pathname, item.exact)
  const Icon = NAV_ICON[item.href]
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? label : undefined}
      title={collapsed ? label : undefined}
      className={`nav-item flex items-center gap-3 rounded-nav py-2 text-[13.5px] font-medium transition-colors duration-150 ${
        collapsed ? 'justify-center px-0' : 'px-3'
      }`}
    >
      {Icon ? <Icon className="flex-none" /> : null}
      {collapsed ? null : <span className="truncate">{label}</span>}
    </Link>
  )
}

function SettingsRow({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean
  onNavigate?: () => void
}) {
  const pathname = usePathname()
  const active = pathname.startsWith('/dashboard/settings')
  return (
    <Link
      href="/dashboard/settings/api-keys"
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? 'Settings' : undefined}
      title={collapsed ? 'Settings' : undefined}
      className={`nav-item flex items-center gap-3 rounded-nav py-2 text-[13.5px] font-medium transition-colors duration-150 ${
        collapsed ? 'justify-center px-0' : 'px-3'
      }`}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="flex-none"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
      {collapsed ? null : <span>Settings</span>}
    </Link>
  )
}

function SidebarBody({
  isAdmin,
  navItems,
  collapsed,
  onToggleCollapse,
  onNavigate,
  showCollapseToggle,
}: {
  isAdmin: boolean
  navItems: readonly NavItem[]
  collapsed: boolean
  onToggleCollapse?: () => void
  onNavigate?: () => void
  showCollapseToggle: boolean
}) {
  return (
    <div className="flex h-full flex-col gap-4 px-3 py-4">
      {/* Top: wordmark and the org switcher pill. */}
      <div className="flex flex-col gap-3">
        {collapsed ? null : (
          <Link href="/dashboard" onClick={onNavigate} className="px-2">
            <Wordmark size="sm" />
          </Link>
        )}
        <div
          className={`glass flex items-center rounded-full ${
            collapsed ? 'w-11 justify-center overflow-hidden' : ''
          }`}
        >
          <OrganizationSwitcher
            hidePersonal
            afterCreateOrganizationUrl="/dashboard"
            afterSelectOrganizationUrl="/dashboard"
          />
        </div>
      </div>

      {/* Middle: the role aware nav. */}
      <nav aria-label="Primary" className="flex flex-1 flex-col gap-0.5">
        {navItems.map((item) => (
          <NavRow
            key={item.href}
            item={item}
            label={item.label}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
        ))}
      </nav>

      {/* Bottom: settings (admin), the collapse control, and the account menu. */}
      <div className="flex flex-col gap-1 border-t border-divider pt-3">
        {isAdmin ? (
          <SettingsRow collapsed={collapsed} onNavigate={onNavigate} />
        ) : null}
        {showCollapseToggle && onToggleCollapse ? (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={`nav-item flex items-center gap-3 rounded-nav py-2 text-[13.5px] font-medium transition-colors duration-150 ${
              collapsed ? 'justify-center px-0' : 'px-3'
            }`}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`flex-none transition-transform duration-200 ${
                collapsed ? 'rotate-180' : ''
              }`}
              aria-hidden="true"
            >
              <path d="M15 6l-6 6 6 6" />
            </svg>
            {collapsed ? null : <span>Collapse</span>}
          </button>
        ) : null}
        <div className={`flex ${collapsed ? 'justify-center' : 'px-2'} pt-1`}>
          <UserButton />
        </div>
      </div>
    </div>
  )
}

/**
 * The stale sweep banner. Rendered above every dashboard page rather than on
 * one screen, because when monitoring stops, every screen is showing values
 * that stopped updating and any one of them read alone is misleading.
 *
 * Plain markup with no dismiss control on purpose: a dismissable warning about
 * a system that is not running would be dismissed once and then never seen
 * again while the outage continued.
 */
function SweepStaleBanner({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div
      role="status"
      className="mx-auto mb-6 flex w-full max-w-[1400px] items-start gap-3 rounded-tile border border-divider bg-wash-accent px-5 py-4"
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="mt-0.5 h-5 w-5 flex-none text-foreground"
      >
        <path
          d="M12 8v5m0 3.5v.5M10.3 3.9 2.5 17.4A2 2 0 0 0 4.2 20.4h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div className="min-w-0">
        <div className="text-[15px] font-semibold text-foreground">{title}</div>
        <div className="mt-0.5 text-[13.5px] text-pretty text-muted-foreground">{subtitle}</div>
      </div>
    </div>
  )
}

export function DashboardShell({
  isAdmin,
  navItems,
  hasKey,
  providers,
  sweepBanner,
  children,
}: {
  isAdmin: boolean
  navItems: readonly NavItem[]
  hasKey: boolean
  providers: ProviderOption[]
  sweepBanner: { title: string; subtitle: string } | null
  children: React.ReactNode
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  // The overlay closes from its own controls (scrim, and onNavigate on every
  // link inside it), so it needs no route effect.

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      {/* Desktop rail, fixed full height. */}
      <aside
        data-collapsed={collapsed}
        className={`hidden flex-none border-r border-border transition-[width] duration-200 ease-out md:block ${
          collapsed ? RAIL_COLLAPSED : RAIL_OPEN
        }`}
      >
        <SidebarBody
          isAdmin={isAdmin}
          navItems={navItems}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((v) => !v)}
          showCollapseToggle
        />
      </aside>

      {/* Narrow overlay: scrim plus off canvas rail. */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMobileOpen(false)}
            className="absolute inset-0 bg-black/55"
          />
          <div className="absolute inset-y-0 left-0 w-[236px] border-r border-border bg-background shadow-card">
            <SidebarBody
              isAdmin={isAdmin}
              navItems={navItems}
              collapsed={false}
              onNavigate={() => setMobileOpen(false)}
              showCollapseToggle={false}
            />
          </div>
        </div>
      ) : null}

      {/* Content column, scrolls on its own. */}
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        {/* Narrow top bar with the menu button. */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3 md:hidden">
          <button
            type="button"
            aria-label="Open menu"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-nav border border-(--toggle-border) bg-(--toggle-bg) text-muted-foreground transition-colors hover:text-foreground"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <Link href="/dashboard">
            <Wordmark size="sm" />
          </Link>
        </div>

        {sweepBanner ? <SweepStaleBanner {...sweepBanner} /> : null}

        {children}
      </div>

      {/* The floating assistant, over the content, unchanged. */}
      <AskTalvexWidget hasKey={hasKey} isAdmin={isAdmin} providers={providers} />
    </div>
  )
}
