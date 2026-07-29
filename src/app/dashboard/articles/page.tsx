import Link from 'next/link'

import { requireAdmin } from '@/lib/auth/org-viewer'
import {
  collectCategories,
  listArticles,
} from '@/lib/db/articles'
import type { ArticleStatus } from '@/lib/db/types'

import { Card } from '../_overview/ui'
import { shortAge } from '../_overview/lib'
import { ghostButton, primaryButton } from '../monitors/ui'
import { ticketFieldClass } from '../tickets/ui'
import { ArticleStatusBadge, AudienceChips } from './ui'

export const metadata = { title: 'Articles — Talvex' }

const ROW = 'grid grid-cols-[minmax(0,1fr)_170px_minmax(0,220px)_110px] gap-3.5'

/**
 * Admin article management (F14). RLS gives an admin every article in the
 * org including drafts; the category filter and title search narrow at the
 * database. Members never reach this screen (requireAdmin, and the nav
 * never offers it); their reading surface lives under Get Help.
 */
export default async function ArticlesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireAdmin()

  const sp = await searchParams
  const asString = (v: string | string[] | undefined) =>
    typeof v === 'string' ? v : ''
  const category = asString(sp.category)
  const q = asString(sp.q)

  // Two reads: the filtered rows to show, and the unfiltered set for the
  // category options so the filter bar never loses entries while filtered.
  const [articles, all] = await Promise.all([
    listArticles({ category: category || undefined, q: q || undefined }),
    listArticles(),
  ])
  const categories = collectCategories(all)
  const drafts = all.filter((a) => a.status === 'draft').length
  const nowMs = new Date().getTime()

  const filterHref = (c?: string) => {
    const params = new URLSearchParams()
    if (c) params.set('category', c)
    if (q) params.set('q', q)
    const s = params.toString()
    return s ? `/dashboard/articles?${s}` : '/dashboard/articles'
  }

  return (
    <main className="mx-auto w-full max-w-[1360px] flex-1 animate-fade-up px-8 pt-[30px] pb-[72px]">
      <div className="mb-[22px] flex flex-wrap items-end justify-between gap-5">
        <div>
          <h1 className="text-title text-foreground">Articles</h1>
          <p className="mt-1.5 text-[14px] text-quiet">
            {all.length} total · {drafts} drafts. Members see what their tags
            admit; empty audience means everyone.
          </p>
        </div>
        <Link href="/dashboard/articles/new" className={primaryButton}>
          New article
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {categories.length > 0 ? (
          <nav
            className="flex flex-wrap items-center gap-1.5 text-sm"
            aria-label="Filter by category"
          >
            <Link
              href={filterHref()}
              aria-current={category === '' ? 'page' : undefined}
              className="nav-item rounded-nav px-3 py-1.5 text-[13px] font-medium transition-colors"
            >
              All
            </Link>
            {categories.map((c) => (
              <Link
                key={c}
                href={filterHref(c)}
                aria-current={category === c ? 'page' : undefined}
                className="nav-item rounded-nav px-3 py-1.5 text-[13px] font-medium transition-colors"
              >
                {c}
              </Link>
            ))}
          </nav>
        ) : (
          <span />
        )}
        <form action="/dashboard/articles" className="flex items-center gap-2">
          {category ? (
            <input type="hidden" name="category" value={category} />
          ) : null}
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search titles"
            className={`${ticketFieldClass} h-10 w-[220px]`}
          />
          <button type="submit" className={`${ghostButton} h-10 px-3.5 py-0`}>
            Search
          </button>
        </form>
      </div>

      {articles.length === 0 ? (
        <Card className="p-8">
          <h2 className="text-base font-semibold text-card-foreground">
            {all.length === 0 ? 'No articles yet' : 'Nothing matches'}
          </h2>
          <p className="mt-3 max-w-[440px] text-sm leading-relaxed text-muted-foreground">
            {all.length === 0
              ? 'Write help articles your members can read from Get Help. Audience tags decide who sees each one; leave them empty for everyone.'
              : 'No articles match this filter. Clear it or try another search.'}
          </p>
          {all.length === 0 ? (
            <Link href="/dashboard/articles/new" className={`${primaryButton} mt-4`}>
              Write the first article
            </Link>
          ) : null}
        </Card>
      ) : (
        <Card className="pb-2">
          <div className={`${ROW} px-[22px] py-3.5 text-column text-quiet uppercase`}>
            <span>Article</span>
            <span>Category</span>
            <span>Audience</span>
            <span>Status</span>
          </div>
          {articles.map((a) => (
            <div
              key={a.id}
              className={`${ROW} items-center border-t border-divider px-[22px] py-3.5`}
            >
              <div className="min-w-0">
                <Link
                  href={`/dashboard/articles/${a.id}/edit`}
                  className="block truncate text-sm font-medium text-foreground hover:text-accent-text"
                >
                  {a.title}
                </Link>
                <div className="mt-0.5 truncate text-[12px] text-quiet">
                  Updated {shortAge(a.updated_at, nowMs)} ago
                </div>
              </div>
              <div className="min-w-0 truncate text-[13px] text-muted-foreground">
                {a.category ?? '—'}
              </div>
              <div className="min-w-0">
                <AudienceChips audienceTags={a.audience_tags} />
              </div>
              <div>
                <ArticleStatusBadge status={a.status as ArticleStatus} />
              </div>
            </div>
          ))}
        </Card>
      )}
    </main>
  )
}
