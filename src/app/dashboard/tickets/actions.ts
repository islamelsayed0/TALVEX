'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { OrgNotSyncedError } from '@/lib/db/monitors'
import {
  addTicketComment,
  createTicket,
  isTicketStatus,
  TicketValidationError,
  updateTicketStatus,
} from '@/lib/db/tickets'

/**
 * Server actions for the tickets UI, following the monitors pattern: parse
 * the form, call the data layer, land somewhere honest. Validation failures
 * round trip through query params so the form re-renders server side with
 * the message and the entered values.
 *
 * Authorization lives in RLS, not here: a member posting a status change by
 * hand simply updates zero rows and lands back on the list. These actions
 * never check roles themselves.
 *
 * redirect() works by throwing, so it is only ever called OUTSIDE the try
 * blocks that catch data layer errors.
 */

function friendlyMessage(err: unknown): string | null {
  if (err instanceof TicketValidationError || err instanceof OrgNotSyncedError) {
    return err.message
  }
  return null
}

export async function createTicketAction(formData: FormData): Promise<void> {
  const input = {
    title: String(formData.get('title') ?? ''),
    description: String(formData.get('description') ?? ''),
  }

  let ticketId: string | null = null
  let failure: string | null = null
  try {
    ticketId = (await createTicket(input)).id
  } catch (err) {
    failure = friendlyMessage(err)
    if (failure === null) throw err
  }
  if (failure !== null || ticketId === null) {
    const query = new URLSearchParams({
      error: failure ?? 'Something went wrong. Try again.',
      title: input.title,
      description: input.description,
    })
    redirect(`/dashboard/get-help?${query}`)
  }

  revalidatePath('/dashboard/tickets')
  redirect(`/dashboard/tickets/${ticketId}?submitted=1`)
}

export async function addTicketCommentAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  const body = String(formData.get('body') ?? '')

  let failure: string | null = null
  let found = true
  try {
    found = (await addTicketComment(id, body)) !== null
  } catch (err) {
    failure = friendlyMessage(err)
    if (failure === null) throw err
  }
  if (failure !== null) {
    const query = new URLSearchParams({ error: failure, body })
    redirect(`/dashboard/tickets/${id}?${query}`)
  }
  // Vanished under our feet, or never visible to this session; RLS makes
  // those identical. The list is the honest place to land.
  if (!found) {
    redirect('/dashboard/tickets')
  }

  revalidatePath(`/dashboard/tickets/${id}`)
  redirect(`/dashboard/tickets/${id}`)
}

export async function updateTicketStatusAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  const status = String(formData.get('status') ?? '')
  if (!isTicketStatus(status)) {
    redirect(`/dashboard/tickets/${id}`)
  }

  let failure: string | null = null
  let found = true
  try {
    // RLS: for a non admin this matches zero rows, whoever they are.
    found = (await updateTicketStatus(id, status)) !== null
  } catch (err) {
    failure = friendlyMessage(err)
    if (failure === null) throw err
  }
  if (failure !== null) {
    const query = new URLSearchParams({ error: failure })
    redirect(`/dashboard/tickets/${id}?${query}`)
  }
  if (!found) {
    redirect('/dashboard/tickets')
  }

  revalidatePath('/dashboard/tickets')
  revalidatePath(`/dashboard/tickets/${id}`)
  redirect(`/dashboard/tickets/${id}`)
}
