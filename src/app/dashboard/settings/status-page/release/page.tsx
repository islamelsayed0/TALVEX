import Link from 'next/link'
import { redirect } from 'next/navigation'

import { requireAdmin } from '@/lib/auth/org-viewer'
import { getStatusPageSettings } from '@/lib/db/status-page'
import { ghostButton, primaryButton } from '../../../monitors/ui'
import { releaseStatusPageAddressAction } from '../actions'

export const metadata = { title: 'Release status page address — Talvext' }

/**
 * The plain confirmation for releasing the status page address, in the
 * monitor delete idiom: its own page, fully server side, primary accent on
 * the confirming button because red is reserved for status meaning, never
 * for chrome. It exists because release is destructive twice over: the
 * public link dies immediately, and the address becomes claimable by anyone
 * the moment it is free.
 */
export default async function ReleaseStatusAddressPage() {
  await requireAdmin()

  const settings = await getStatusPageSettings()
  // Nothing to release; the settings page is the honest place to land.
  if (!settings.slug) redirect('/dashboard/settings/status-page')

  return (
    <main id="main-content" className="flex flex-1 flex-col gap-6 p-8">
      <div className="flex max-w-md flex-col gap-4 rounded-button border border-border bg-card p-6">
        <h1 className="text-title text-card-foreground">
          Release /status/{settings.slug}?
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          The public link stops working immediately, and the address becomes
          available for anyone to claim the moment it is released. If you only
          want the page offline for a while, turn it off instead: a page that
          is off keeps its address reserved for you.
        </p>
        <form action={releaseStatusPageAddressAction} className="flex items-center gap-3">
          <button type="submit" className={primaryButton}>
            Release address
          </button>
          <Link href="/dashboard/settings/status-page" className={ghostButton}>
            Cancel
          </Link>
        </form>
      </div>
    </main>
  )
}
