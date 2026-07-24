'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { draftEscalation } from '@/lib/chat/escalation'
import { setConversationStatus } from '@/lib/db/chat'

/**
 * Server actions for chat (following the tickets pattern). Escalation drafts a
 * ticket from the conversation and hands the member to the Get help ticket form
 * prefilled and fully editable; the ticket is created through the normal path,
 * and creating it marks the conversation escalated (createTicket does that).
 * Resolution is a one tap status change.
 *
 * redirect() throws, so it is only called outside the try blocks.
 */

export async function escalateConversationAction(formData: FormData): Promise<void> {
  const conversationId = String(formData.get('conversation_id') ?? '')
  if (conversationId === '') {
    redirect('/dashboard/chat')
  }

  // draftEscalation never throws for provider reasons; it falls back. A thrown
  // error here means the conversation is not the caller's, so land on the list.
  let draft: { title: string; description: string }
  try {
    draft = await draftEscalation(conversationId)
  } catch {
    redirect('/dashboard/chat')
  }

  const params = new URLSearchParams({
    conversation_id: conversationId,
    title: draft.title,
    description: draft.description,
  })
  redirect(`/dashboard/get-help/ticket?${params}`)
}

export async function markConversationResolvedAction(
  formData: FormData,
): Promise<void> {
  const conversationId = String(formData.get('conversation_id') ?? '')
  if (conversationId === '') {
    redirect('/dashboard/chat')
  }
  // RLS lets only the creator do this; for anyone else it matches zero rows.
  await setConversationStatus(conversationId, 'resolved')
  revalidatePath(`/dashboard/chat/${conversationId}`)
  redirect(`/dashboard/chat/${conversationId}`)
}
