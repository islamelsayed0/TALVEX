import Link from 'next/link'

/**
 * The public footer: wordmark, current year, and the three legal links.
 *
 * Mounted on the public surfaces only, meaning the landing page, the legal
 * pages, and tenant status pages. The authenticated dashboard shell does not
 * carry it; the dashboard gets its own compact link set in settings later.
 *
 * The year is read at render time. Every public page here is statically
 * generated, so in practice it is stamped at build and refreshes on the next
 * deploy, which beats a hardcoded literal that nobody remembers to bump.
 *
 * `trailing` is for a surface that already had something in its footer before
 * this component existed; the landing page passes its repository link.
 */

const LEGAL_LINKS = [
  { href: '/terms', label: 'Terms' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/accessibility', label: 'Accessibility' },
] as const

export function SiteFooter({ trailing }: { trailing?: React.ReactNode }) {
  const year = new Date().getFullYear()

  return (
    <footer className="border-t border-border py-11">
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-[18px] px-8">
        <div className="flex flex-wrap items-center gap-4">
          <span className="font-display text-[18px] font-semibold text-secondary-foreground">
            Talvex
          </span>
          <p className="text-[13px] text-quiet">© {year} Talvex</p>
        </div>
        <div className="flex flex-wrap items-center gap-5">
          <nav aria-label="Legal" className="flex flex-wrap items-center gap-5">
            {LEGAL_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-[13.5px] font-medium text-quiet transition-colors hover:text-foreground"
              >
                {link.label}
              </Link>
            ))}
          </nav>
          {trailing}
        </div>
      </div>
    </footer>
  )
}
