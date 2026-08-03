import { describe, expect, it } from 'vitest'

import { ACCESSIBILITY } from '@/app/(legal)/_content/accessibility'
import { PRIVACY } from '@/app/(legal)/_content/privacy'
import { TERMS } from '@/app/(legal)/_content/terms'
import {
  documentBlocks,
  findPlaceholders,
  type LegalDocument,
} from '@/lib/legal/documents'

/**
 * The legal pages' house rules, held the same way the landing page holds its
 * copy rules.
 *
 * The load bearing one is the placeholder inventory. A legal document ships
 * with square bracket blanks and every one of them has to be filled before it
 * means anything, so the exact set is written down here. Filling one, adding
 * one, or pasting in a new draft that carries its own blanks all fail this
 * suite, which is the point: the list cannot drift without somebody looking at
 * it.
 */

const DOCUMENTS: Array<[string, LegalDocument]> = [
  ['terms', TERMS],
  ['privacy', PRIVACY],
  ['accessibility', ACCESSIBILITY],
]

/** Documents whose drafted copy has not landed yet. Shrinking this list is the
 * whole job; growing it should never happen. */
const PENDING = new Set(['terms', 'privacy'])

/**
 * Every placeholder still open, per document. Update this only when the
 * corresponding blank is genuinely filled or a new draft is pasted in, and say
 * so in the pull request.
 */
const OPEN_PLACEHOLDERS: Record<string, string[]> = {
  terms: [],
  privacy: [],
  accessibility: ['[ACCESSIBILITY EMAIL]', '[DATE]'],
}

describe('legal documents', () => {
  it.each(DOCUMENTS)('%s has a title and a description', (_name, doc) => {
    expect(doc.title.trim()).not.toBe('')
    expect(doc.description.trim()).not.toBe('')
  })

  it.each(DOCUMENTS)(
    '%s carries exactly the placeholders we accepted',
    (name, doc) => {
      expect(findPlaceholders(doc.source)).toEqual(OPEN_PLACEHOLDERS[name])
    },
  )

  it.each(DOCUMENTS)('%s parses into the blocks the page renders', (name, doc) => {
    const blocks = documentBlocks(doc)
    if (PENDING.has(name)) {
      // A pending document renders the notice, not prose. If prose appears
      // here, someone wrote legal language into a file that says not to.
      expect(blocks).toEqual([])
    } else {
      expect(blocks.length).toBeGreaterThan(0)
    }
  })

  it('keeps the accessibility statement exactly as supplied', () => {
    // The supplied document, verbatim. Its own "## Accessibility at Talvex"
    // title line lives in `title` and renders as the page h1, so it is not
    // repeated in the body.
    expect(ACCESSIBILITY.title).toBe('Accessibility at Talvex')
    expect(ACCESSIBILITY.source).toBe(
      `Talvex is committed to making our platform usable by as many people as possible, including people with disabilities. We aim to conform to the Web Content Accessibility Guidelines (WCAG) 2.2 Level AA.

Our platform is designed and tested with keyboard navigation, screen reader compatibility, visible focus indicators, and sufficient color contrast in mind. Status information is always conveyed by text and icons, never by color alone. Accessibility is an ongoing effort, and some portions of the platform may not yet fully conform. We review accessibility as part of every release.

If you encounter an accessibility barrier, need assistance, or would like to request an accommodation, contact us at [ACCESSIBILITY EMAIL]. We will make reasonable efforts to provide the information or functionality you need through an alternative method, and we welcome feedback that helps us improve.

This statement was last reviewed on [DATE].`,
    )
  })

  it('keeps the no hyphen rule in the copy we wrote ourselves', () => {
    // Titles and descriptions are ours. Document bodies are not: legal prose is
    // pasted verbatim and is never reworded to satisfy a house style rule.
    for (const [, doc] of DOCUMENTS) {
      expect(doc.title).not.toMatch(/-/)
      expect(doc.description).not.toMatch(/-/)
    }
  })
})

describe('findPlaceholders', () => {
  it('finds bracketed blanks in order, without repeats', () => {
    expect(
      findPlaceholders('Write to [SUPPORT EMAIL] before [DATE]. Again [DATE].'),
    ).toEqual(['[SUPPORT EMAIL]', '[DATE]'])
  })

  it('ignores ordinary bracketed prose and markdown links', () => {
    expect(findPlaceholders('the party [as defined above] agrees')).toEqual([])
    expect(findPlaceholders('see the [Privacy Policy](/privacy)')).toEqual([])
    // A link whose text is shaped like a placeholder is still a link.
    expect(findPlaceholders('[TERMS](/terms)')).toEqual([])
  })
})
