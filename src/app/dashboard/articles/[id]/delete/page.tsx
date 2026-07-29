import Link from 'next/link'
import { notFound } from 'next/navigation'

import { requireAdmin } from '@/lib/auth/org-viewer'
import { getArticle } from '@/lib/db/articles'

import { ghostButton, primaryButton } from '../../../monitors/ui'
import { deleteArticleAction } from '../../actions'

export const metadata = { title: 'Delete article — Talvex' }

/**
 * The plain confirmation for deletion, the monitors idiom: its own page,
 * fully server side. The delete button uses the primary accent, not red;
 * red is reserved for status meaning, never chrome.
 */
export default async function DeleteArticlePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireAdmin()

  const { id } = await params
  const article = await getArticle(id)
  if (!article) notFound()

  return (
    <main className="flex flex-1 flex-col gap-6 p-8">
      <div className="flex max-w-md flex-col gap-4 rounded-button border border-border bg-card p-6">
        <h1 className="text-title text-card-foreground">
          Delete {article.title}?
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          This removes the article for every reader. There is no undo.
        </p>
        <form action={deleteArticleAction} className="flex items-center gap-3">
          <input type="hidden" name="id" value={article.id} />
          <button type="submit" className={primaryButton}>
            Delete article
          </button>
          <Link href={`/dashboard/articles/${article.id}/edit`} className={ghostButton}>
            Cancel
          </Link>
        </form>
      </div>
    </main>
  )
}
