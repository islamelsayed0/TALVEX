import Link from 'next/link'

import { SiteFooter } from '@/components/site-footer'

/**
 * Minimal chrome for the public legal pages: the wordmark linking home, the
 * document itself, and the shared footer.
 *
 * These pages are public by construction, not by exception. The proxy only
 * protects the prefixes in src/lib/auth/routes.ts (/dashboard and
 * /select-org), so a signed out visitor reaches /terms, /privacy, and
 * /accessibility without a redirect. tests/auth-routes.test.ts holds that
 * open, because a legal page that demands a login is a legal page nobody can
 * read before they agree to it.
 *
 * The product is dark only, a locked decision recorded in docs/DECISIONS.md
 * and enforced by tests/design-tokens.test.ts, so these pages take the same
 * palette as the status page and the rest of the app.
 */
export default function LegalLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-border px-8 py-[18px]">
        <div className="mx-auto flex max-w-[1240px] items-center justify-between gap-6">
          <Link
            href="/"
            className="font-display text-[22px] font-semibold tracking-[-0.02em] text-foreground"
          >
            Talvext
          </Link>
          <Link
            href="/"
            className="text-[14.5px] font-medium text-secondary-foreground transition-colors hover:text-foreground"
          >
            Back to Talvext
          </Link>
        </div>
      </header>

      <main id="main-content" className="flex-1">{children}</main>

      <SiteFooter />
    </div>
  )
}
