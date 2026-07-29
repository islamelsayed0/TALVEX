'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getActiveOrgViewer } from '@/lib/auth/org-viewer'
import {
  StatusPageValidationError,
  saveStatusPageSettings,
} from '@/lib/db/status-page'

/**
 * Server action for the status page settings, the notifications actions shape.
 * RLS is the real boundary (admin only update policy, migration 011), but this
 * also gates on isAdmin first. A bad or taken slug is a form error carried back
 * in the query string, never a 500. redirect() throws, so it is only called
 * outside the try block.
 */

const PAGE = '/dashboard/settings/status-page'

export async function saveStatusPageSettingsAction(
  formData: FormData,
): Promise<void> {
  const viewer = await getActiveOrgViewer()
  if (!viewer.isAdmin) redirect(PAGE)

  const input = {
    enabled: formData.get('enabled') === 'on',
    slug: String(formData.get('slug') ?? ''),
  }

  let failure: string | null = null
  try {
    await saveStatusPageSettings(input)
  } catch (err) {
    if (err instanceof StatusPageValidationError) {
      failure = err.message
    } else {
      throw err
    }
  }
  if (failure !== null) {
    redirect(`${PAGE}?${new URLSearchParams({ error: failure })}`)
  }

  revalidatePath(PAGE)
  redirect(`${PAGE}?saved=1`)
}
