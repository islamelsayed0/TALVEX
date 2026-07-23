import Link from 'next/link'
import { notFound } from 'next/navigation'

import { getMonitor } from '@/lib/db/monitors'
import { deleteMonitorAction } from '../../actions'
import { ghostButton, primaryButton } from '../../ui'

export const metadata = { title: 'Delete monitor — Talvex' }

/**
 * The plain confirmation for deletion: its own page, fully server side.
 * The delete button deliberately uses the primary accent, not red; red is
 * reserved for status meaning (a monitor being down), never for chrome.
 */
export default async function DeleteMonitorPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const monitor = await getMonitor(id)
  if (!monitor) notFound()

  return (
    <main className="flex flex-1 flex-col gap-6 p-8">
      <div className="flex max-w-md flex-col gap-4 rounded-button border border-border bg-card p-6">
        <h1 className="text-title text-card-foreground">
          Delete {monitor.name}?
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          This removes the monitor and its whole check history. There is no
          undo.
        </p>
        <form action={deleteMonitorAction} className="flex items-center gap-3">
          <input type="hidden" name="id" value={monitor.id} />
          <button type="submit" className={primaryButton}>
            Delete monitor
          </button>
          <Link href={`/dashboard/monitors/${monitor.id}`} className={ghostButton}>
            Cancel
          </Link>
        </form>
      </div>
    </main>
  )
}
