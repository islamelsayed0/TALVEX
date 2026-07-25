import { currentUser } from '@clerk/nextjs/server'
import Link from 'next/link'

import { getActiveOrgViewer } from '@/lib/auth/org-viewer'
import { orgHasKey } from '@/lib/db/api-keys'
import { countOpenIncidents } from '@/lib/db/incidents'

import { ghostButton, primaryButton } from '../monitors/ui'

export const metadata = { title: 'Help — Talvex' }

const TICKET_HREF = '/dashboard/help/ticket'
const CHAT_HREF = '/dashboard/chat/new'

type CommonTopic = {
  title: string
  hint: string
  icon: React.ReactNode
}

const KeyIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M21 2l-2 2m-7.6 7.6a5 5 0 1 0-1.4 1.4m1.4-1.4L21 4m-7 7 2 2" />
    <circle cx="6.5" cy="16.5" r="3.5" />
  </svg>
)
const PrinterIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="6" y="14" width="12" height="8" rx="1" />
    <path d="M6 18H4a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-2" />
    <path d="M6 9V3h12v6" />
  </svg>
)
const MailIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="m2 7 10 6 10-6" />
  </svg>
)
const GlobeIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="10" />
    <path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20" />
  </svg>
)

const COMMON: CommonTopic[] = [
  { title: 'Reset a password', hint: 'For you or a coworker', icon: KeyIcon },
  { title: 'Printer or device offline', hint: 'Something will not connect', icon: PrinterIcon },
  { title: 'Email problems', hint: 'Sending, receiving or spam', icon: MailIcon },
  { title: 'Remote access or VPN', hint: 'Working from home', icon: GlobeIcon },
]

/**
 * The Help home, restyled to the handoff. It is the shared front door: members
 * land here, and an admin reaches it from the Help nav. Behavior preserved from
 * the original (Task 5 addendum):
 *   - No key degradation: the AI entry appears only when the org has a provider
 *     key. Without one, every path routes to a request instead of a dead end.
 *   - Admins with no key see a quiet hint to add one in settings.
 * The "aware of an issue" banner is real: it appears only when the org actually
 * has open incidents, and it stays jargon free (members cannot open incident
 * detail, so it does not link there).
 */
export default async function HelpHomePage() {
  const [user, hasKey, viewer, openIncidents] = await Promise.all([
    currentUser(),
    orgHasKey(),
    getActiveOrgViewer(),
    countOpenIncidents(),
  ])
  const firstName = user?.firstName ?? 'there'
  const topicHref = hasKey ? CHAT_HREF : TICKET_HREF

  return (
    <main className="mx-auto w-full max-w-[600px] flex-1 animate-fade-up px-6 pt-8 pb-20">
      <div className="mx-auto max-w-[600px] text-center">
        <h1 className="text-[30px] font-semibold tracking-[-0.02em] text-foreground">
          Hi, {firstName}
        </h1>
        <p className="mt-2.5 text-[15.5px] leading-relaxed text-pretty text-muted-foreground">
          How can we help today? {hasKey ? 'Ask our assistant, or send' : 'Send'}{' '}
          a request straight to your IT team.
        </p>
      </div>

      {hasKey ? (
        <Link
          href={CHAT_HREF}
          className="glass mt-[26px] flex items-center gap-3 rounded-nested p-4 pl-[18px]"
        >
          <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[10px] bg-accent-gradient">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--primary-foreground)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 3l1.5 5.1L18.5 9.5 13.5 11 12 16l-1.5-5L5.5 9.5 10.5 8.1z" />
            </svg>
          </span>
          <span className="flex-1 text-[15px] text-quiet">
            Describe what is going on...
          </span>
          <span className={`${primaryButton} flex-none px-4 py-2`}>Ask</span>
        </Link>
      ) : null}

      {openIncidents > 0 ? (
        <div className="mt-3.5 flex items-center gap-3 rounded-nested border border-card-border bg-tile px-4 py-3">
          <span className="h-2 w-2 flex-none rounded-full bg-status-pending" aria-hidden />
          <span className="flex-1 text-[13.5px] text-pretty text-muted-foreground">
            Your IT team is aware of an issue affecting some services right now
            and is on it.
          </span>
        </div>
      ) : null}

      <div className="mt-[22px] flex gap-3.5">
        <Link href={TICKET_HREF} className={`${primaryButton} flex-1`}>
          New request
        </Link>
        <Link href="/dashboard/tickets" className={`${ghostButton} flex-1`}>
          My requests
        </Link>
      </div>

      {!hasKey && viewer.isAdmin ? (
        <p className="mt-3.5 text-center text-xs text-quiet">
          Want the AI assistant here too?{' '}
          <Link
            href="/dashboard/settings/api-keys"
            className="text-accent-text hover:underline"
          >
            Add an API key in settings
          </Link>
          .
        </p>
      ) : null}

      <div className="mt-9">
        <div className="mb-3.5 text-section text-quiet uppercase">Common help</div>
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          {COMMON.map((topic) => (
            <Link
              key={topic.title}
              href={topicHref}
              className="flex items-start gap-3 rounded-nested border border-card-border bg-tile p-[15px] transition-colors hover:bg-card-hover"
            >
              <span className="flex h-8 w-8 flex-none items-center justify-center rounded-[9px] bg-tile text-muted-foreground">
                {topic.icon}
              </span>
              <span>
                <span className="block text-sm font-medium text-foreground">
                  {topic.title}
                </span>
                <span className="mt-0.5 block text-[12.5px] text-quiet">
                  {topic.hint}
                </span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </main>
  )
}
