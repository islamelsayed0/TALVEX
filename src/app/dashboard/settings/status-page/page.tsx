import { headers } from 'next/headers'
import Link from 'next/link'

import { requireAdmin } from '@/lib/auth/org-viewer'
import { getStatusPageSettings } from '@/lib/db/status-page'

import { Card } from '../../_overview/ui'
import { primaryButton } from '../../monitors/ui'
import { FormError, ticketFieldClass } from '../../tickets/ui'
import { SettingsNav } from '../nav'
import { saveStatusPageSettingsAction } from './actions'
import { CopyLink } from './copy-link'

export const metadata = { title: 'Settings — Talvext' }

/**
 * Status page settings (F9), admin only like the other settings surfaces. One
 * form: an enable toggle and a slug. The slug is validated server side against
 * the same rules as the check constraint, and a globally unique conflict comes
 * back as a form error. When the page is live its public URL is shown as a
 * copyable link; changing the slug takes effect immediately and retires the old
 * one.
 */
export default async function StatusPageSettings({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const asString = (v: string | string[] | undefined) =>
    typeof v === 'string' ? v : ''

  await requireAdmin()

  const settings = await getStatusPageSettings()

  const h = await headers()
  const host = h.get('host') ?? ''
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const liveUrl =
    settings.enabled && settings.slug
      ? `${proto}://${host}/status/${settings.slug}`
      : null

  const saved = asString(sp.saved) === '1'
  const released = asString(sp.released) === '1'
  const error = asString(sp.error)

  return (
    <main id="main-content" className="mx-auto w-full max-w-[780px] flex-1 animate-fade-up px-8 pt-[30px] pb-[72px]">
      <div className="mb-[22px]">
        <h1 className="text-title text-foreground">Settings</h1>
        <p className="mt-1.5 text-[14px] text-quiet">
          Manage your workspace, team and integrations.
        </p>
      </div>

      <SettingsNav />

      {saved ? (
        <Card className="mb-[18px] px-5 py-4 text-sm text-card-foreground">
          Saved. Your status page reflects this within a minute.
        </Card>
      ) : null}

      {released ? (
        <Card className="mb-[18px] px-5 py-4 text-sm text-card-foreground">
          The address was released. It is free for anyone to claim now.
        </Card>
      ) : null}

      <Card className="px-[22px] py-5">
        <h2 className="text-base font-semibold text-foreground">Status page</h2>
        <p className="mt-1 text-[12.5px] text-quiet">
          A public page your clients can check to see if your systems are up, no
          login. Monitor names and status only; URLs stay private.
        </p>

        {liveUrl ? (
          <div className="mt-4 flex flex-col gap-1.5">
            <span className="text-[12.5px] text-muted-foreground">Live at</span>
            <div className="flex flex-wrap items-center gap-3">
              <CopyLink url={liveUrl} />
              <Link
                href="/dashboard/settings/status-page/release"
                className="text-[12.5px] text-link underline hover:text-foreground"
              >
                Release this address
              </Link>
            </div>
          </div>
        ) : settings.slug ? (
          // The page is off but the address is still reserved: the exact
          // state that used to be invisible and made a held slug look free.
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="text-[12.5px] text-muted-foreground">
              Your page is off, and /status/{settings.slug} is still reserved
              for you.
            </span>
            <Link
              href="/dashboard/settings/status-page/release"
              className="text-[12.5px] text-link underline hover:text-foreground"
            >
              Release this address
            </Link>
          </div>
        ) : null}

        <form
          action={saveStatusPageSettingsAction}
          className="mt-5 flex flex-col gap-4 border-t border-divider pt-5"
          autoComplete="off"
        >
          <FormError message={error || undefined} />

          <label className="flex items-center gap-2.5 text-sm text-foreground">
            <input
              name="enabled"
              type="checkbox"
              defaultChecked={settings.enabled}
              className="h-4 w-4 accent-(--status-up)"
            />
            Make my status page public
          </label>
          <p className="text-[12px] text-quiet">
            Turning the page off keeps your address reserved for you. Releasing
            the address is what frees it for anyone.
          </p>

          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] text-muted-foreground">
              Status page address
            </span>
            <div className="flex items-center gap-2">
              <span className="flex-none font-mono text-[12.5px] text-quiet">
                /status/
              </span>
              <input
                name="slug"
                type="text"
                defaultValue={settings.slug ?? ''}
                placeholder="acme"
                className={`${ticketFieldClass} h-11 flex-1`}
              />
            </div>
            <span className="text-[12px] text-quiet">
              Lowercase letters, numbers and single hyphens, 3 to 63 characters.
              Changing it takes effect immediately and the old link stops
              working.
            </span>
          </label>

          <div>
            <button type="submit" className={primaryButton}>
              Save status page
            </button>
          </div>
        </form>
      </Card>
    </main>
  )
}
