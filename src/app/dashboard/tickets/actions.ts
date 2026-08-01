'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { OrgNotSyncedError } from '@/lib/db/monitors'
import {
  addTicketComment,
  createTicket,
  isTicketStatus,
  memberHideTicket,
  memberSetTicketStatus,
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
  // incident_id (Task 4) and conversation_id (Task 5) are present only when the
  // form was opened from an incident or a chat escalation. Passed through to
  // the data layer, where RLS pins each to something in the caller's own org; a
  // value from elsewhere fails the insert.
  const incidentId = String(formData.get('incident_id') ?? '')
  const conversationId = String(formData.get('conversation_id') ?? '')
  const input = {
    title: String(formData.get('title') ?? ''),
    description: String(formData.get('description') ?? ''),
    incidentId: incidentId || null,
    conversationId: conversationId || null,
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
    const params: Record<string, string> = {
      error: failure ?? 'Something went wrong. Try again.',
      title: input.title,
      description: input.description,
    }
    // Keep the link on the round trip so a failed submit does not lose it.
    if (incidentId) params.incident_id = incidentId
    if (conversationId) params.conversation_id = conversationId
    redirect(`/dashboard/help/ticket?${new URLSearchParams(params)}`)
  }

  revalidatePath('/dashboard/tickets')
  redirect(`/dashboard/tickets/${ticketId}?submitted=1`)
}

export async function addTicketCommentAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  const body = String(formData.get('body') ?? '')
  // The Internal note toggle. Checked only by the database: a member who
  // forges this checkbox gets 42501 from the insert policy, not a nicer
  // looking failure from here.
  const isInternal = formData.get('is_internal') === 'on'

  let failure: string | null = null
  let found = true
  try {
    found = (await addTicketComment(id, body, isInternal)) !== null
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

/**
 * The requester's own lifecycle actions: resolve, cancel, reopen.
 *
 * These never touch the tickets table directly. memberSetTicketStatus calls
 * member_set_ticket_status, which is where the state machine and the reopen
 * explanation requirement actually live; this action parses a form and shows
 * what came back. A member posting an illegal transition by hand reaches the
 * same refusal, because there is no other path.
 */
export async function memberSetTicketStatusAction(
  formData: FormData,
): Promise<void> {
  const id = String(formData.get('id') ?? '')
  const status = String(formData.get('status') ?? '')
  const explanation = String(formData.get('explanation') ?? '')
  if (!isTicketStatus(status)) {
    redirect(`/dashboard/tickets/${id}`)
  }

  let failure: string | null = null
  try {
    await memberSetTicketStatus(id, status, explanation)
  } catch (err) {
    failure = friendlyMessage(err)
    if (failure === null) throw err
  }
  if (failure !== null) {
    // The typed explanation rides back so a refused reopen does not throw away
    // what the person wrote.
    const query = new URLSearchParams({ error: failure })
    if (explanation) query.set('explanation', explanation)
    redirect(`/dashboard/tickets/${id}?${query}`)
  }

  revalidatePath('/dashboard/tickets')
  revalidatePath(`/dashboard/tickets/${id}`)
  redirect(`/dashboard/tickets/${id}`)
}

/** Remove a settled ticket from the requester's own list. The row stays. */
export async function memberHideTicketAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')

  let failure: string | null = null
  try {
    await memberHideTicket(id)
  } catch (err) {
    failure = friendlyMessage(err)
    if (failure === null) throw err
  }
  if (failure !== null) {
    const query = new URLSearchParams({ error: failure })
    redirect(`/dashboard/tickets/${id}?${query}`)
  }

  revalidatePath('/dashboard/tickets')
  redirect('/dashboard/tickets')
}

/**
 * The admin close dialog: an optional message to the requester, an optional
 * internal note, then resolve.
 *
 * Order matters and is deliberate. Both comments are written BEFORE the status
 * change, so the trail reads as the explanation followed by the outcome, and
 * so a failure on either comment leaves the ticket open rather than silently
 * resolved with the explanation missing.
 */
export async function adminCloseTicketAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  const message = String(formData.get('message') ?? '').trim()
  const note = String(formData.get('note') ?? '').trim()

  let failure: string | null = null
  let found = true
  try {
    if (message !== '') {
      found = (await addTicketComment(id, message, false)) !== null
    }
    if (found && note !== '') {
      found = (await addTicketComment(id, note, true)) !== null
    }
    if (found) {
      found = (await updateTicketStatus(id, 'resolved')) !== null
    }
  } catch (err) {
    failure = friendlyMessage(err)
    if (failure === null) throw err
  }
  if (failure !== null) {
    const query = new URLSearchParams({ error: failure })
    if (message) query.set('message', message)
    if (note) query.set('note', note)
    redirect(`/dashboard/tickets/${id}?${query}`)
  }
  if (!found) {
    redirect('/dashboard/tickets')
  }

  revalidatePath('/dashboard/tickets')
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
