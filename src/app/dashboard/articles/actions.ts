'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import {
  ArticleValidationError,
  createArticle,
  deleteArticle,
  setArticleStatus,
  updateArticle,
  type ArticleInput,
} from '@/lib/db/articles'
import { OrgNotSyncedError } from '@/lib/db/monitors'
import { parseTagInput } from '@/lib/db/tags'

/**
 * Server actions for the article screens, the monitors pattern: parse the
 * form, call the data layer, land somewhere honest. Validation failures
 * round trip through query params so the form re-renders server side with
 * the message and the entered values.
 *
 * Authorization lives in RLS, not here: a member posting one of these by
 * hand updates zero rows or is refused by the database. These actions never
 * check roles themselves.
 *
 * redirect() works by throwing, so it is only ever called OUTSIDE the try
 * blocks that catch data layer errors.
 */

function parseForm(formData: FormData): ArticleInput {
  return {
    title: String(formData.get('title') ?? ''),
    body: String(formData.get('body') ?? ''),
    category: String(formData.get('category') ?? ''),
    audienceTags: parseTagInput(String(formData.get('audience') ?? '')),
  }
}

/** Query string that refills the form and shows the error. */
function formQuery(input: ArticleInput, message: string): string {
  return new URLSearchParams({
    error: message,
    title: input.title,
    category: input.category,
    audience: input.audienceTags.join(', '),
    body: input.body,
  }).toString()
}

function friendlyMessage(err: unknown): string | null {
  if (err instanceof ArticleValidationError || err instanceof OrgNotSyncedError) {
    return err.message
  }
  return null
}

export async function createArticleAction(formData: FormData): Promise<void> {
  const input = parseForm(formData)

  let failure: string | null = null
  try {
    await createArticle(input)
  } catch (err) {
    failure = friendlyMessage(err)
    if (failure === null) throw err
  }
  if (failure !== null) {
    redirect(`/dashboard/articles/new?${formQuery(input, failure)}`)
  }

  revalidatePath('/dashboard/articles')
  redirect('/dashboard/articles')
}

export async function updateArticleAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  const input = parseForm(formData)

  let failure: string | null = null
  let found = true
  try {
    found = (await updateArticle(id, input)) !== null
  } catch (err) {
    failure = friendlyMessage(err)
    if (failure === null) throw err
  }
  if (failure !== null) {
    redirect(`/dashboard/articles/${id}/edit?${formQuery(input, failure)}`)
  }
  if (!found) {
    redirect('/dashboard/articles')
  }

  revalidatePath('/dashboard/articles')
  redirect('/dashboard/articles')
}

export async function setArticleStatusAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  const status = String(formData.get('status') ?? '')
  if (status === 'draft' || status === 'published') {
    await setArticleStatus(id, status)
  }
  revalidatePath('/dashboard/articles')
  redirect('/dashboard/articles')
}

export async function deleteArticleAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  await deleteArticle(id)

  revalidatePath('/dashboard/articles')
  redirect('/dashboard/articles')
}
