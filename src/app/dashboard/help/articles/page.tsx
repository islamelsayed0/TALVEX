import Link from 'next/link'

import { groupArticlesByCategory, listArticles } from '@/lib/db/articles'

import { Card } from '../../_overview/ui'
import { ghostButton } from '../../monitors/ui'
import { ticketFieldClass } from '../../tickets/ui'

export const metadata = { title: 'Help articles — Talvex' }

/**
 * The member reading list (F14), a door off Get Help. RLS is the entire
 * visibility rule: this session receives published articles whose audience
 * admits them and nothing else, so there is no locked state, no count of
 * hidden rows, nothing here to indicate other articles exist. Grouped by
 * category with a simple title search. Member facing copy: no jargon, and
 * the word tags never appears on this side.
 */
export default async function HelpArticlesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const q = typeof sp.q === 'string' ? sp.q : ''

  // Admins reading through this door see their whole org via their own RLS,
  // drafts included; keep the reading surface to what members get.
  const articles = (await listArticles({ q: q || undefined })).filter(
    (a) => a.status === 'published',
  )
  const groups = groupArticlesByCategory(articles)

  return (
    <main className="mx-auto w-full max-w-[720px] flex-1 animate-fade-up px-6 pt-[30px] pb-[72px]">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-title text-foreground">Help articles</h1>
          <p className="mt-1.5 text-[14px] text-quiet">
            Guides from your IT team.
          </p>
        </div>
        <Link href="/dashboard/help" className={ghostButton}>
          Back to help
        </Link>
      </div>

      <form action="/dashboard/help/articles" className="mb-5 flex items-center gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search articles"
          className={`${ticketFieldClass} h-11 flex-1`}
        />
        <button type="submit" className={`${ghostButton} h-11 flex-none px-4 py-0`}>
          Search
        </button>
      </form>

      {articles.length === 0 ? (
        <Card className="p-8">
          <h2 className="text-base font-semibold text-card-foreground">
            {q ? 'Nothing matches' : 'No articles here yet'}
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {q
              ? 'Try different words, or send us a request and we will help directly.'
              : 'When your IT team publishes guides for you, they will show up here.'}
          </p>
          <Link href="/dashboard/help/ticket" className={`${ghostButton} mt-4`}>
            New request
          </Link>
        </Card>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((group) => (
            <div key={group.category}>
              <div className="mb-2.5 text-section text-quiet uppercase">
                {group.category}
              </div>
              <Card className="pb-1 pt-1">
                {group.articles.map((a) => (
                  <Link
                    key={a.id}
                    href={`/dashboard/help/articles/${a.id}`}
                    className="flex items-center gap-3.5 border-t border-divider px-[22px] py-[14px] transition-colors first:border-t-0 hover:bg-card-hover"
                  >
                    <span className="min-w-0 flex-1 truncate text-[14.5px] font-medium text-foreground">
                      {a.title}
                    </span>
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="flex-none text-quiet"
                      aria-hidden
                    >
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </Link>
                ))}
              </Card>
            </div>
          ))}
        </div>
      )}
    </main>
  )
}
