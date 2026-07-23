import { createMonitorAction } from '../actions'
import { MonitorForm } from '../ui'

export const metadata = { title: 'Add monitor — Talvex' }

/**
 * Add a monitor. On a failed submit the server action redirects back here
 * with the message and the entered values in the query string, so the form
 * re-renders filled in without any client code.
 */
export default async function NewMonitorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const asString = (v: string | string[] | undefined) =>
    typeof v === 'string' ? v : ''

  return (
    <main className="flex flex-1 flex-col gap-6 p-8">
      <div>
        <h1 className="text-title text-foreground">Add a monitor</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Tell us what to watch. Checks start on the next sweep.
        </p>
      </div>
      <MonitorForm
        action={createMonitorAction}
        submitLabel="Add monitor"
        cancelHref="/dashboard/monitors"
        error={asString(sp.error) || undefined}
        defaults={{
          name: asString(sp.name),
          url: asString(sp.url),
          intervalSeconds: Number(asString(sp.interval)) || 300,
        }}
      />
    </main>
  )
}
