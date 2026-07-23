import { notFound } from 'next/navigation'

import { getMonitor } from '@/lib/db/monitors'
import { updateMonitorAction } from '../../actions'
import { MonitorForm } from '../../ui'

export const metadata = { title: 'Edit monitor — Talvex' }

export default async function EditMonitorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams])
  const monitor = await getMonitor(id)
  if (!monitor) notFound()

  const asString = (v: string | string[] | undefined) =>
    typeof v === 'string' ? v : ''
  const error = asString(sp.error) || undefined

  return (
    <main className="flex flex-1 flex-col gap-6 p-8">
      <div>
        <h1 className="text-title text-foreground">Edit monitor</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{monitor.name}</p>
      </div>
      <MonitorForm
        action={updateMonitorAction}
        submitLabel="Save changes"
        cancelHref={`/dashboard/monitors/${monitor.id}`}
        monitorId={monitor.id}
        showActive
        error={error}
        defaults={
          error
            ? {
                name: asString(sp.name),
                url: asString(sp.url),
                intervalSeconds: Number(asString(sp.interval)) || monitor.interval_seconds,
                active: monitor.active,
              }
            : {
                name: monitor.name,
                url: monitor.url,
                intervalSeconds: monitor.interval_seconds,
                active: monitor.active,
              }
        }
      />
    </main>
  )
}
