import { createTicketAction } from '../tickets/actions'
import { FormError, ticketFieldClass } from '../tickets/ui'
import { primaryButton } from '../monitors/ui'

export const metadata = { title: 'Get help — Talvex' }

/**
 * The submission surface (Task 3 ruling 4): one screen, one obvious action,
 * no jargon. The person here is often non technical and possibly stressed;
 * the screen asks two plain questions and gets out of the way. On a failed
 * submit the server action redirects back with the message and the entered
 * values in the query string, so nothing typed is ever lost.
 */
export default async function GetHelpPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const asString = (v: string | string[] | undefined) =>
    typeof v === 'string' ? v : ''

  return (
    <main className="flex flex-1 flex-col items-center p-8">
      <div className="flex w-full max-w-md flex-col gap-6 pt-6">
        <div>
          <h1 className="text-title text-foreground">Get help</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            Tell us what is going on and the team takes it from there. Plain
            words are perfect.
          </p>
        </div>

        <form action={createTicketAction} className="flex flex-col gap-5">
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
