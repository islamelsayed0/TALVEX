'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import {
  createMonitor,
  deleteMonitor,
  MonitorValidationError,
  OrgNotSyncedError,
  updateMonitor,
} from '@/lib/db/monitors'

/**
 * Server actions for the monitors UI. Thin: parse the form, call the data
 * layer, go back to the list. Validation failures round trip through query
 * params so the form re-renders server side with the message and the
 * entered values; no client component needed for plain forms.
 *
 * redirect() works by throwing, so it is only ever called OUTSIDE the try
 * blocks that catch data layer errors.
 */

type ParsedForm = {
  name: string
  url: string
  intervalSeconds: number
}

function parseForm(formData: FormData): ParsedForm {
  return {
    name: String(formData.get('name') ?? ''),
    url: String(formData.get('url') ?? ''),
    intervalSeconds: Number(formData.get('interval') ?? Number.NaN),
  }
}

/** Query string that refills the form and shows the error. */
function formQuery(input: ParsedForm, message: string): string {
  return new URLSearchParams({
    error: message,
    name: input.name,
    url: input.url,
    interval: String(input.intervalSeconds),
  }).toString()
}

function friendlyMessage(err: unknown): string | null {
  if (err instanceof MonitorValidationError || err instanceof OrgNotSyncedError) {
    return err.message
  }
  return null
}

export async function createMonitorAction(formData: FormData): Promise<void> {
  const input = parseForm(formData)

  let failure: string | null = null
  try {
    await createMonitor(input)
  } catch (err) {
    failure = friendlyMessage(err)
    if (failure === null) throw err
  }
  if (failure !== null) {
    redirect(`/dashboard/monitors/new?${formQuery(input, failure)}`)
  }

  revalidatePath('/dashboard/monitors')
  redirect('/dashboard/monitors')
}

export async function updateMonitorAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  const input = parseForm(formData)
  const active = formData.get('active') === 'on'

  let failure: string | null = null
  let found = true
  try {
    found = (await updateMonitor(id, { ...input, active })) !== null
  } catch (err) {
    failure = friendlyMessage(err)
    if (failure === null) throw err
  }
  if (failure !== null) {
    redirect(`/dashboard/monitors/${id}/edit?${formQuery(input, failure)}`)
  }
  // Vanished under our feet (deleted elsewhere, or never this org's row —
  // RLS makes those look identical). The list is the honest place to land.
  if (!found) {
    redirect('/dashboard/monitors')
  }

  revalidatePath('/dashboard/monitors')
  revalidatePath(`/dashboard/monitors/${id}`)
  redirect(`/dashboard/monitors/${id}`)
}

export async function deleteMonitorAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  await deleteMonitor(id)

  revalidatePath('/dashboard/monitors')
  redirect('/dashboard/monitors')
}
