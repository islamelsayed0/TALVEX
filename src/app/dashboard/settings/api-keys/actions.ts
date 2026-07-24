'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getActiveOrgViewer } from '@/lib/auth/org-viewer'
import {
  ApiKeyValidationError,
  deleteApiKey,
  saveApiKey,
} from '@/lib/db/api-keys'

/**
 * Server actions for key management. RLS is the real boundary (admin only), but
 * these also gate on isAdmin BEFORE doing any work, so a non admin who posts
 * the form by hand cannot trigger the save time provider validation call (which
 * spends against the org's key) before the database refuses the write.
 * redirect() throws, so it is only called outside the try blocks.
 */

const PAGE = '/dashboard/settings/api-keys'

export async function saveApiKeyAction(formData: FormData): Promise<void> {
  const viewer = await getActiveOrgViewer()
  if (!viewer.isAdmin) redirect(PAGE)

  const provider = String(formData.get('provider') ?? '')
  const key = String(formData.get('key') ?? '')

  let failure: string | null = null
  try {
    await saveApiKey(provider, key)
  } catch (err) {
    if (err instanceof ApiKeyValidationError) {
      failure = err.message
    } else {
      throw err
    }
  }
  if (failure !== null) {
    redirect(`${PAGE}?${new URLSearchParams({ error: failure, provider })}`)
  }

  revalidatePath(PAGE)
  redirect(`${PAGE}?${new URLSearchParams({ saved: provider })}`)
}

export async function deleteApiKeyAction(formData: FormData): Promise<void> {
  const viewer = await getActiveOrgViewer()
  if (!viewer.isAdmin) redirect(PAGE)

  const provider = String(formData.get('provider') ?? '')
  try {
    await deleteApiKey(provider)
  } catch (err) {
    if (!(err instanceof ApiKeyValidationError)) throw err
  }

  revalidatePath(PAGE)
  redirect(`${PAGE}?${new URLSearchParams({ removed: provider })}`)
}
