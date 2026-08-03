import Link from 'next/link'
import { notFound } from 'next/navigation'

import { requireAdmin } from '@/lib/auth/org-viewer'
import {
  collectAudienceTags,
  collectCategories,
  getArticle,
  listArticles,
} from '@/lib/db/articles'

import { ghostButton, primaryButton } from '../../../monitors/ui'
import { setArticleStatusAction } from '../../actions'
import { updateArticleAction } from '../../actions'
import { ArticleForm, ArticleStatusBadge, articleFormDefaults } from '../../ui'
import type { ArticleStatus } from '@/lib/db/types'

export const metadata = { title: 'Edit document — Talvex' }

/**
 * Edit, publish, unpublish, or head to deletion. Publish state is its own
 * form, separate from the field edits, so one press does one thing and the
 * audit log records exactly one action either way.
 */
export default async function EditArticlePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireAdmin()

  const { id } = await params
  const sp = await searchParams
  const asString = (v: string | string[] | undefined) =>
    typeof v === 'string' ? v : ''

  const [article, all] = await Promise.all([getArticle(id), listArticles()])
  if (!article) notFound()

  const status = article.status as ArticleStatus
  const hasRoundTrip = asString(sp.error) !== ''
  const defaults = hasRoundTrip
    ? {
        title: asString(sp.title),
        category: asString(sp.category),
        audienceTags: asString(sp.audience),
        body: asString(sp.body),
      }
    : articleFormDefaults(article)

  return (
    <main id="main-content" className="flex flex-1 flex-col gap-6 p-8">
      <div className="flex max-w-[640px] flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-title text-foreground">Edit document</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Saving changes keeps the current publish state.
          </p>
        </div>
        <ArticleStatusBadge status={status} />
      </div>

      <ArticleForm
        action={updateArticleAction}
        submitLabel="Save changes"
        cancelHref="/dashboard/articles"
        error={asString(sp.error) || undefined}
        defaults={defaults}
        categorySuggestions={collectCategories(all)}
        tagSuggestions={collectAudienceTags(all)}
        articleId={article.id}
      />

      <div className="flex w-full max-w-[640px] items-center justify-between gap-3 rounded-button border border-border bg-card p-6">
        <form action={setArticleStatusAction}>
          <input type="hidden" name="id" value={article.id} />
          <input
            type="hidden"
            name="status"
            value={status === 'draft' ? 'published' : 'draft'}
          />
          <button
            type="submit"
            className={status === 'draft' ? primaryButton : ghostButton}
          >
            {status === 'draft' ? 'Publish' : 'Unpublish'}
          </button>
        </form>
        <Link
          href={`/dashboard/articles/${article.id}/delete`}
          className={ghostButton}
        >
          Delete
        </Link>
      </div>
    </main>
  )
}
