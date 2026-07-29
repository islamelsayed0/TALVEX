'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { updateMemberTags } from '@/lib/db/member-tags'
import { parseTagInput, TagValidationError } from '@/lib/db/tags'

/**
 * Server action for the Members settings tab. Thin by the monitors pattern:
 * parse, call the data layer, land back on the tab. Authorization lives in
 * RLS (the tags column policy from migration 014); a non admin posting this
 * by hand is refused by the database, never by a role check here.
 */
export async function updateMemberTagsAction(formData: FormData): Promise<void> {
  const clerkUserId = String(formData.get('clerk_user_id') ?? '')
  const raw = String(formData.get('tags') ?? '')

  let failure: string | null = null
  try {
    await updateMemberTags(clerkUserId, parseTagInput(raw))
  } catch (err) {
    if (err instanceof TagValidationError) {
      failure = err.message
    } else {
      throw err
    }
  }
  if (failure !== null) {
    const query = new URLSearchParams({ error: failure, member: clerkUserId })
    redirect(`/dashboard/settings/members?${query}`)
  }

  revalidatePath('/dashboard/settings/members')
  redirect('/dashboard/settings/members?saved=1')
}
