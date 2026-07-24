import Link from 'next/link'

import { orgHasKey } from '@/lib/db/api-keys'
import { getActiveOrgViewer } from '@/lib/auth/org-viewer'
import { primaryButton, ghostButton } from '../monitors/ui'

export const metadata = { title: 'Get help — Talvex' }

/**
 * The single front door for help (Task 5 addendum). Two clear doors, zero
 * jargon, the office worker test:
 *   - Primary, recommended: try the AI assistant, with one line of nudge.
 *   - Secondary, always visible, never buried: create a ticket instead.
 *
 * No key degradation: when the org has no provider key, the AI door does not
 * appear at all and only the ticket path renders, so a member never hits a dead
 * end. Admins additionally see a quiet hint linking to key settings.
 */
export default async function GetHelpPage() {
  const [hasKey, viewer] = await Promise.all([orgHasKey(), getActiveOrgViewer()])

  return (
    <main className="flex flex-1 flex-col items-center p-8">
      <div className="flex w-full max-w-md flex-col gap-6 pt-6">
        <div>
          <h1 className="text-title text-foreground">Get help</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            Pick the way that suits you. Either one reaches your IT team if it
            needs to.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          {hasKey ? (
            <div className="flex flex-col gap-3 rounded-button border border-border bg-card p-6">
              <h2 className="text-base font-semibold text-card-foreground">
                Try the AI assistant
              </h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Most issues can be sorted out in a few minutes with the
                assistant. If it cannot help, it can send your request to the
                team.
              </p>
              <Link
                href="/dashboard/chat/new"
                className={`${primaryButton} w-full`}
              >
                Start with the assistant
              </Link>
            </div>
          ) : null}

          <div className="flex flex-col gap-3 rounded-button border border-border bg-card p-6">
            <h2 className="text-base font-semibold text-card-foreground">
              Create a ticket
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Tell the team what is going on and they take it from there.
            </p>
            <Link
              href="/dashboard/get-help/ticket"
              className={`${hasKey ? ghostButton : primaryButton} w-full`}
            >
              Create a ticket instead
            </Link>
          </div>

          {!hasKey && viewer.isAdmin ? (
            <p className="text-xs text-quiet">
              Want the AI assistant here too?{' '}
              <Link
                href="/dashboard/settings/api-keys"
                className="text-accent-text hover:underline"
              >
                Add an API key in settings
              </Link>{' '}
              to turn it on.
            </p>
          ) : null}
        </div>
      </div>
    </main>
  )
}
