import type { ComponentType, SVGProps } from 'react'

/**
 * Nav icons, hand rolled inline SVGs in the repo's existing icon idiom (stroke,
 * 1.8 width, round caps, currentColor), keyed by route so the pure nav-items
 * data stays free of JSX. No icon dependency added; these match the settings
 * gear and the Ask Talvex mark already in the shell.
 */
type Icon = ComponentType<SVGProps<SVGSVGElement>>

function base(props: SVGProps<SVGSVGElement>) {
  return {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    ...props,
  }
}

const Overview: Icon = (p) => (
  <svg {...base(p)}>
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" />
    <rect x="3" y="16" width="7" height="5" rx="1.5" />
  </svg>
)

const Monitors: Icon = (p) => (
  <svg {...base(p)}>
    <path d="M3 12h4l2.5 6 4-14 2.5 8H21" />
  </svg>
)

const Incidents: Icon = (p) => (
  <svg {...base(p)}>
    <path d="M10.3 3.3 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.3a2 2 0 0 0-3.4 0z" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </svg>
)

const Tickets: Icon = (p) => (
  <svg {...base(p)}>
    <path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z" />
    <path d="M13 6v12" strokeDasharray="2 3" />
  </svg>
)

const Help: Icon = (p) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.2 9a2.8 2.8 0 0 1 5.4 1c0 1.8-2.6 2.4-2.6 4" />
    <path d="M12 17h.01" />
  </svg>
)

/** Route to icon. Members reuse the same routes with different labels. */
export const NAV_ICON: Record<string, Icon> = {
  '/dashboard': Overview,
  '/dashboard/monitors': Monitors,
  '/dashboard/incidents': Incidents,
  '/dashboard/tickets': Tickets,
  '/dashboard/help': Help,
}
