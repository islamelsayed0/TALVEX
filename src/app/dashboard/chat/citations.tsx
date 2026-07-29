import Link from 'next/link'

import type { GroundingCitation } from '@/lib/chat/retrieval'

/**
 * Reference cards under an assistant message that answered from the
 * knowledge base, in the chat ticket card idiom (the escalated notice's
 * ticket link). Presentational only and free of server imports, so the
 * live pane, the popup, and the read only transcript all render the same
 * cards. Every citation arriving here already passed the viewer's scoped
 * articles read; anything the viewer may not see was omitted upstream.
 */
export function ArticleCitations({ citations }: { citations: GroundingCitation[] }) {
  if (citations.length === 0) return null
  return (
    <div className="flex max-w-[85%] flex-col gap-1.5">
      <span className="px-1 text-[11px] text-quiet">From your documents</span>
      {citations.map((c) => (
        <Link
          key={c.id}
          href={`/dashboard/help/articles/${c.id}`}
          className="flex items-center gap-2.5 rounded-button border border-border bg-card px-4 py-2.5 transition-colors hover:border-(--ghost-border-hover)"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="flex-none text-quiet"
            aria-hidden
          >
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
          </svg>
          <span className="min-w-0 truncate text-[13px] font-medium text-card-foreground">
            {c.title}
          </span>
        </Link>
      ))}
    </div>
  )
}
