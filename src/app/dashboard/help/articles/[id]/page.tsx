import Link from 'next/link'
import { notFound } from 'next/navigation'

import { parseMarkdown } from '@/lib/articles/markdown'
import { getArticle } from '@/lib/db/articles'

import { ghostButton } from '../../../monitors/ui'
import { MarkdownView } from '../markdown-view'

export const metadata = { title: 'Help articles — Talvex' }

/**
 * One article, rendered from markdown to React elements server side (never
 * raw HTML). RLS already decided this session may read it; an article
 * outside the caller's audience, a draft, or another org's row all resolve
 * to null here and 404 identically, indistinguishable from never existing.
 */
export default async function HelpArticlePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const article = await getArticle(id)
  if (!article || article.status !== 'published') notFound()

  const blocks = parseMarkdown(article.body)

  return (
    <main className="mx-auto w-full max-w-[720px] flex-1 animate-fade-up px-6 pt-[30px] pb-[72px]">
      <div className="mb-6">
        <Link
          href="/dashboard/help/articles"
          className="text-[13px] font-medium text-quiet transition-colors hover:text-foreground"
        >
          ← All articles
        </Link>
      </div>

      {article.category ? (
        <div className="mb-2 text-section text-quiet uppercase">
          {article.category}
        </div>
      ) : null}
      <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-foreground">
        {article.title}
      </h1>

      <div className="mt-6">
        <MarkdownView blocks={blocks} />
      </div>

      <div className="mt-10 flex items-center justify-between gap-4 rounded-nested border border-card-border bg-tile px-5 py-4">
        <span className="text-[13.5px] text-muted-foreground">
          Did not solve it? Your IT team can help directly.
        </span>
        <Link href="/dashboard/help/ticket" className={`${ghostButton} flex-none`}>
          New request
        </Link>
      </div>
    </main>
  )
}
