import { StatusText, type StatusTone } from '@/components/status-mark'
import type { Article, ArticleStatus } from '@/lib/db/types'

import { ghostButton, primaryButton } from '../monitors/ui'
import { FormError, ticketFieldClass } from '../tickets/ui'

/**
 * Shared server rendered pieces for the admin article screens. No client
 * components; every form posts to a server action, and validation failures
 * round trip through query params (the monitors form idiom).
 */

export const ARTICLE_STATUS_LABEL: Record<ArticleStatus, string> = {
  draft: 'Draft',
  published: 'Published',
}

/** Draft is waiting (ring), published is live (circle). */
const STATUS_TONE: Record<ArticleStatus, StatusTone> = {
  draft: 'pending',
  published: 'up',
}

export function ArticleStatusBadge({ status }: { status: ArticleStatus }) {
  return (
    <StatusText
      tone={STATUS_TONE[status]}
      label={ARTICLE_STATUS_LABEL[status]}
      size={8}
    />
  )
}

/**
 * Who can read this article, as chips. An empty audience is labeled visible
 * to everyone (ruling 4); a targeted one lists its tags. Admin side only:
 * the word tags never appears on the member side.
 */
export function AudienceChips({ audienceTags }: { audienceTags: string[] }) {
  if (audienceTags.length === 0) {
    return (
      <span className="rounded-full bg-tile px-2 py-0.5 text-[10.5px] font-medium text-chip-text">
        Visible to everyone
      </span>
    )
  }
  return (
    <span className="flex flex-wrap gap-1">
      {audienceTags.map((tag) => (
        <span
          key={tag}
          className="rounded-full bg-tile px-2 py-0.5 text-[10.5px] font-medium text-chip-text"
        >
          {tag}
        </span>
      ))}
    </span>
  )
}

export type ArticleFormDefaults = {
  title: string
  category: string
  audienceTags: string
  body: string
}

export function articleFormDefaults(article: Article): ArticleFormDefaults {
  return {
    title: article.title,
    category: article.category ?? '',
    audienceTags: article.audience_tags.join(', '),
    body: article.body,
  }
}

/**
 * The create and edit form. Category and audience suggest existing values
 * from current data (no category or tag table, ruling 3): category through a
 * native datalist, audience as a hint line of tags already in use. Body is a
 * plain textarea for markdown by ruling; no editor dependency.
 */
export function ArticleForm({
  action,
  submitLabel,
  cancelHref,
  defaults,
  categorySuggestions,
  tagSuggestions,
  error,
  articleId,
}: {
  action: (formData: FormData) => Promise<void>
  submitLabel: string
  cancelHref: string
  defaults: ArticleFormDefaults
  categorySuggestions: string[]
  tagSuggestions: string[]
  error?: string
  articleId?: string
}) {
  return (
    <form
      action={action}
      className="flex w-full max-w-[640px] flex-col gap-4 rounded-button border border-border bg-card p-6"
    >
      {articleId ? <input type="hidden" name="id" value={articleId} /> : null}
      <FormError message={error} />

      <label className="flex flex-col gap-1.5">
        <span className="text-[12.5px] text-muted-foreground">Title</span>
        <input
          name="title"
          defaultValue={defaults.title}
          required
          maxLength={200}
          className={ticketFieldClass}
          placeholder="How to connect the office printer"
        />
      </label>

      <div className="flex flex-col gap-4 sm:flex-row">
        <label className="flex flex-1 flex-col gap-1.5">
          <span className="text-[12.5px] text-muted-foreground">Category</span>
          <input
            name="category"
            defaultValue={defaults.category}
            maxLength={60}
            list="article-categories"
            className={ticketFieldClass}
            placeholder="Printers"
          />
          <datalist id="article-categories">
            {categorySuggestions.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <span className="text-[11.5px] text-quiet">
            Groups documents for readers. Leave empty for General.
          </span>
        </label>

        <label className="flex flex-1 flex-col gap-1.5">
          <span className="text-[12.5px] text-muted-foreground">
            Audience tags
          </span>
          <input
            name="audience"
            defaultValue={defaults.audienceTags}
            className={ticketFieldClass}
            placeholder="onsite, printers"
          />
          <span className="text-[11.5px] text-quiet">
            Comma separated. Empty means visible to everyone.
            {tagSuggestions.length > 0
              ? ` In use: ${tagSuggestions.join(', ')}.`
              : ''}
          </span>
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-[12.5px] text-muted-foreground">
          Body (markdown)
        </span>
        <textarea
          name="body"
          defaultValue={defaults.body}
          required
          rows={16}
          className={`${ticketFieldClass} h-auto min-h-[320px] resize-y py-3 leading-relaxed`}
          placeholder={'## Before you start\n\n1. Step one\n2. Step two'}
        />
      </label>

      <div className="flex items-center gap-3">
        <button type="submit" className={primaryButton}>
          {submitLabel}
        </button>
        <a href={cancelHref} className={ghostButton}>
          Cancel
        </a>
      </div>
    </form>
  )
}
