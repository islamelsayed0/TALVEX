import { auth } from '@clerk/nextjs/server'

import { createOrgScopedClient } from './client'
import { OrgNotSyncedError } from './monitors'
import { TagValidationError, validatedTags } from './tags'
import type { Article, ArticleStatus } from './types'

/**
 * Typed data layer for help articles (BRD F14, CLAUDE.md code rule 7).
 * Everything runs on the org scoped client, so THE VISIBILITY CONTRACT has
 * already been applied before any code here sees a row: a member gets
 * published articles whose audience is empty or overlaps their tags, an
 * admin gets the whole org including drafts, and nobody gets another org's
 * rows. Nothing in this file re-implements that rule; the database is the
 * authority and this layer just asks. Chat grounding later reads articles
 * through this same layer as the asking user and inherits the contract for
 * free.
 */

/** User input failed validation; message is safe to show as form feedback. */
export class ArticleValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ArticleValidationError'
  }
}

const TITLE_MAX = 200
const BODY_MAX = 50_000
const CATEGORY_MAX = 60

export type ArticleInput = {
  title: string
  body: string
  category: string
  /** Raw tag input; normalized (lowercase, trimmed, deduplicated) and
   * bounded here. Empty means visible to every member. */
  audienceTags: string[]
}

type ValidatedArticle = {
  title: string
  body: string
  category: string | null
  audience_tags: string[]
}

function validated(input: ArticleInput): ValidatedArticle {
  const title = input.title.trim()
  const body = input.body.trim()
  const category = input.category.trim()
  if (title === '') {
    throw new ArticleValidationError('Give the document a title.')
  }
  if (title.length > TITLE_MAX) {
    throw new ArticleValidationError('Keep the title under 200 characters.')
  }
  if (body === '') {
    throw new ArticleValidationError('Write the document body first.')
  }
  if (body.length > BODY_MAX) {
    throw new ArticleValidationError(
      'That document is very long. Keep it under 50,000 characters.',
    )
  }
  if (category.length > CATEGORY_MAX) {
    throw new ArticleValidationError('Keep the category under 60 characters.')
  }
  let audience_tags: string[]
  try {
    audience_tags = validatedTags(input.audienceTags)
  } catch (err) {
    if (err instanceof TagValidationError) {
      throw new ArticleValidationError(err.message)
    }
    throw err
  }
  return { title, body, category: category === '' ? null : category, audience_tags }
}

/** % and _ are LIKE wildcards; a searcher typing them means the characters. */
function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, (ch) => `\\${ch}`)
}

// ---------------------------------------------------------------------------
// Pure helpers for the screens, unit tested.

/** Articles grouped by category for the member reading list, uncategorized
 * last under the given label, categories alphabetical, titles alphabetical
 * within each. */
export function groupArticlesByCategory(
  articles: Article[],
  uncategorizedLabel = 'General',
): Array<{ category: string; articles: Article[] }> {
  const groups = new Map<string, Article[]>()
  for (const article of articles) {
    const key = article.category ?? ''
    groups.set(key, [...(groups.get(key) ?? []), article])
  }
  const named = [...groups.entries()]
    .filter(([key]) => key !== '')
    .sort(([a], [b]) => a.localeCompare(b))
  const uncategorized = groups.get('')
  const result = named.map(([category, list]) => ({ category, articles: list }))
  if (uncategorized) {
    result.push({ category: uncategorizedLabel, articles: uncategorized })
  }
  for (const group of result) {
    group.articles.sort((a, b) => a.title.localeCompare(b.title))
  }
  return result
}

/** Distinct categories present, alphabetical: the filter options and the
 * category suggestions, always from current data (no category table). */
export function collectCategories(articles: Article[]): string[] {
  return [...new Set(articles.map((a) => a.category).filter((c): c is string => !!c))].sort(
    (a, b) => a.localeCompare(b),
  )
}

/** Distinct audience tags in use, alphabetical: the tag suggestions, always
 * from current data (no tag table). */
export function collectAudienceTags(articles: Article[]): string[] {
  return [...new Set(articles.flatMap((a) => a.audience_tags))].sort((a, b) =>
    a.localeCompare(b),
  )
}

// ---------------------------------------------------------------------------
// Queries. RLS does the audience work; these just narrow and order.

export type ArticleFilter = {
  category?: string
  q?: string
}

/**
 * The articles this session may see, newest first. For a member that is
 * published rows their tags admit; for an admin, everything in the org.
 * Optional narrowing by exact category and simple title search.
 */
export async function listArticles(filter: ArticleFilter = {}): Promise<Article[]> {
  const { client } = await createOrgScopedClient()
  let query = client.from('articles').select().order('created_at', { ascending: false })
  if (filter.category) query = query.eq('category', filter.category)
  if (filter.q?.trim()) query = query.ilike('title', `%${escapeLike(filter.q.trim())}%`)
  const { data, error } = await query
  if (error) throw error
  return data
}

/** One article by id, or null when this session cannot see it. For a member
 * outside the audience that is indistinguishable from not existing, which is
 * the point. */
export async function getArticle(id: string): Promise<Article | null> {
  const { client } = await createOrgScopedClient()
  const { data, error } = await client
    .from('articles')
    .select()
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data
}

/**
 * Create a draft as the signed in admin. Status is not sent: every article
 * is born a draft by the column default, and the insert grant does not even
 * include the status column. The audit row is written by the database
 * trigger, not here.
 */
export async function createArticle(input: ArticleInput): Promise<Article> {
  const row = validated(input)
  const { client, orgId } = await createOrgScopedClient()
  const { userId } = await auth()
  if (!userId) throw new Error('No signed in user on this session.')

  const { data: org, error: orgError } = await client
    .from('organizations')
    .select('id')
    .eq('clerk_org_id', orgId)
    .maybeSingle()
  if (orgError) throw orgError
  if (!org) throw new OrgNotSyncedError()

  const { data, error } = await client
    .from('articles')
    .insert({ ...row, org_id: org.id, created_by: userId })
    .select()
    .single()
  if (error) throw error
  return data
}

/**
 * Edit an article's fields. RLS makes this admin only: for anyone else the
 * update matches zero rows and null comes back, indistinguishable from an
 * article that does not exist. The audit trigger records which fields
 * changed; publish state moves through publishArticle below, never here.
 */
export async function updateArticle(
  id: string,
  input: ArticleInput,
): Promise<Article | null> {
  const row = validated(input)
  const { client } = await createOrgScopedClient()
  const { data, error } = await client
    .from('articles')
    .update(row)
    .eq('id', id)
    .select()
    .maybeSingle()
  if (error) throw error
  return data
}

/** Publish or unpublish. published_at is trigger managed; the audit trigger
 * maps the transition (draft to published is article_published, back is
 * article_unpublished) and records exactly one row. */
export async function setArticleStatus(
  id: string,
  status: ArticleStatus,
): Promise<Article | null> {
  const { client } = await createOrgScopedClient()
  const { data, error } = await client
    .from('articles')
    .update({ status })
    .eq('id', id)
    .select()
    .maybeSingle()
  if (error) throw error
  return data
}

/** Delete an article. Admin only via RLS; a non admin's delete matches zero
 * rows. The audit trigger records the deletion with the title. */
export async function deleteArticle(id: string): Promise<void> {
  const { client } = await createOrgScopedClient()
  const { error } = await client.from('articles').delete().eq('id', id)
  if (error) throw error
}
