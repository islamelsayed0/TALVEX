import Link from 'next/link'

import { createTicketAction } from '../../tickets/actions'
import { FormError, ticketFieldClass } from '../../tickets/ui'
import { primaryButton } from '../../monitors/ui'

export const metadata = { title: 'Create a ticket — Talvex' }

/**
 * The ticket form (Task 3's Get help surface, now the secondary door behind the
 * Get help chooser, Task 5 addendum). One screen, two plain questions, no
 * jargon. On a failed submit the server action round trips the message and the
 * entered values through the query string, so nothing typed is lost.
 *
 * It may open prefilled from an incident (incident_id, Task 4) or from a chat
 * escalation (conversation_id, Task 5). Either id rides along in a hidden field
 * so the new ticket links back; RLS pins each to something in the caller's own
 * org, and a ticket carries at most one origin.
 */
export default async function CreateTicketPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const asString = (v: string | string[] | undefined) =>
    typeof v === 'string' ? v : ''

  const incidentId = asString(sp.incident_id)
  const conversationId = asString(sp.conversation_id)
  const fromIncident = incidentId !== ''
  const fromChat = conversationId !== ''

  const intro = fromIncident
    ? 'This request starts from an incident. Edit anything below, then send it to the team.'
    : fromChat
      ? 'This request starts from your chat. Edit anything below, then send it to the team.'
      : 'Tell us what is going on and the team takes it from there. Plain words are perfect.'

  return (
    <main className="flex flex-1 flex-col items-center p-8">
      <div className="flex w-full max-w-md flex-col gap-6 pt-6">
        <div>
          <Link
            href="/dashboard/get-help"
            className="text-xs text-link hover:text-foreground"
          >
            ← Back to Get help
          </Link>
          <h1 className="mt-2 text-title text-foreground">Create a ticket</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            {intro}
          </p>
        </div>

        <form action={createTicketAction} className="flex flex-col gap-5">
          {fromIncident ? (
            <input type="hidden" name="incident_id" value={incidentId} />
          ) : null}
          {fromChat ? (
            <input type="hidden" name="conversation_id" value={conversationId} />
          ) : null}
          <FormError message={asString(sp.error) || undefined} />

          <label className="flex flex-col gap-1.5">
            <span className="text-sm text-muted-foreground">
              What do you need help with?
            </span>
            <input
              name="title"
              type="text"
              required
              maxLength={200}
              defaultValue={asString(sp.title)}
              placeholder="A few words, like: the printer will not print"
              className={`${ticketFieldClass} h-12`}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm text-muted-foreground">What happened?</span>
            <textarea
              name="description"
              required
              rows={6}
              maxLength={10000}
              defaultValue={asString(sp.description)}
              placeholder="What were you trying to do, and what did you see instead?"
              className={`${ticketFieldClass} resize-y py-3 leading-relaxed`}
            />
          </label>

          <div className="mt-1 flex flex-col gap-3">
            <button type="submit" className={primaryButton}>
              Send to the team
            </button>
            <p className="text-xs text-quiet">
              You can follow your request and add details any time under
              Tickets.
            </p>
          </div>
        </form>
      </div>
    </main>
  )
}
