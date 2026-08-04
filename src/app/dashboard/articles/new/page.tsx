import { requireAdmin } from '@/lib/auth/org-viewer'
import { collectAudienceTags, collectCategories, listArticles } from '@/lib/db/articles'

import { createArticleAction } from '../actions'
import { ArticleForm } from '../ui'

export const metadata = { title: 'New document — Talvext' }

/**
 * Write an article. Every article is born a draft; publishing is a separate
 * action from the edit screen. On a failed submit the server action
 * redirects back here with the message and the entered values in the query
 * string, so the form re-renders filled in without any client code.
 */
export default async function NewArticlePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireAdmin()

  const sp = await searchParams
  const asString = (v: string | string[] | undefined) =>
    typeof v === 'string' ? v : ''

  const all = await listArticles()

  return (
    <main id="main-content" className="flex flex-1 flex-col gap-6 p-8">
      <div>
        <h1 className="text-title text-foreground">New document</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Drafts stay private to admins until you publish.
        </p>
      </div>
      <ArticleForm
        action={createArticleAction}
        submitLabel="Save draft"
        cancelHref="/dashboard/articles"
        error={asString(sp.error) || undefined}
        defaults={{
          title: asString(sp.title),
          category: asString(sp.category),
          audienceTags: asString(sp.audience),
          body: asString(sp.body),
        }}
        categorySuggestions={collectCategories(all)}
        tagSuggestions={collectAudienceTags(all)}
      />
    </main>
  )
}
