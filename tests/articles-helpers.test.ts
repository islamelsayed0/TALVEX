import { describe, expect, it } from 'vitest'

import {
  collectAudienceTags,
  collectCategories,
  groupArticlesByCategory,
} from '@/lib/db/articles'
import type { Article } from '@/lib/db/types'

// Pure screen helpers for articles (F14): category grouping for the member
// reading list and the suggestion lists the admin forms build from current
// data (no category or tag table by ruling).

function article(over: Partial<Article>): Article {
  return {
    id: over.id ?? crypto.randomUUID(),
    org_id: 'org',
    title: 'Untitled',
    body: 'Body',
    category: null,
    audience_tags: [],
    status: 'published',
    created_by: 'user_1',
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    published_at: null,
    ...over,
  }
}

describe('groupArticlesByCategory', () => {
  it('groups alphabetically with uncategorized last under the given label', () => {
    const groups = groupArticlesByCategory([
      article({ title: 'Zebra', category: 'Printers' }),
      article({ title: 'Alpha', category: null }),
      article({ title: 'Beta', category: 'Email' }),
    ])
    expect(groups.map((g) => g.category)).toEqual(['Email', 'Printers', 'General'])
  })

  it('sorts titles alphabetically within a group', () => {
    const groups = groupArticlesByCategory([
      article({ title: 'Zebra', category: 'Printers' }),
      article({ title: 'Alpha', category: 'Printers' }),
    ])
    expect(groups[0].articles.map((a) => a.title)).toEqual(['Alpha', 'Zebra'])
  })

  it('is empty for no articles, not a lone empty group', () => {
    expect(groupArticlesByCategory([])).toEqual([])
  })
})

describe('collectCategories', () => {
  it('returns distinct categories alphabetically, skipping null', () => {
    const categories = collectCategories([
      article({ category: 'Printers' }),
      article({ category: 'Email' }),
      article({ category: 'Printers' }),
      article({ category: null }),
    ])
    expect(categories).toEqual(['Email', 'Printers'])
  })
})

describe('collectAudienceTags', () => {
  it('returns distinct tags in use, alphabetically', () => {
    const tags = collectAudienceTags([
      article({ audience_tags: ['onsite', 'finance'] }),
      article({ audience_tags: ['finance'] }),
      article({ audience_tags: [] }),
    ])
    expect(tags).toEqual(['finance', 'onsite'])
  })
})
