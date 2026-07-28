'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getActiveOrgViewer } from '@/lib/auth/org-viewer'
import {
  DEFAULT_TIMEZONE,
  TimezoneValidationError,
  saveOrgTimezone,
} from '@/lib/db/usage'

/**
 * Server actions for the usage screen, the notifications actions.ts shape.
 * RLS is the real boundary (the admin only update policy from migration 012),
 * but both actions also gate on isAdmin before doing any work. A bad zone is
 * a form error carried back in the query string, never a silent drop.
 * redirect() throws, so it is only called outside the try block.
 */

const PAGE = '/dashboard/settings/usage'

export async function saveTimezoneAction(formData: FormData): Promise<void> {
  const viewer = await getActiveOrgViewer()
  if (!viewer.isAdmin) redirect(PAGE)

  let failure: string | null = null
  try {
    await saveOrgTimezone(String(formData.get('timezone') ?? ''))
  } catch (err) {
    if (err instanceof TimezoneValidationError) {
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

/**
 * The zero setup path: on an admin's first visit while the org zone is
 * unset, the client detects the browser zone and lands it here. Writes only
 * while the column is still NULL, so it can never overwrite a stored zone,
 * and stores the DEFAULT_TIMEZONE fallback when detection yields nothing the
 * server recognizes. Silent on purpose: the page refreshes right after.
 */
export async function autoSetTimezoneAction(detected: string): Promise<void> {
  const viewer = await getActiveOrgViewer()
  if (!viewer.isAdmin) return

  try {
    await saveOrgTimezone(detected, { onlyIfUnset: true })
  } catch (err) {
    if (err instanceof TimezoneValidationError) {
      await saveOrgTimezone(DEFAULT_TIMEZONE, { onlyIfUnset: true })
    } else {
      throw err
    }
  }
  revalidatePath(PAGE)
}
