import { describe, expect, it } from 'vitest'

import { ACCESSIBILITY } from '@/app/(legal)/_content/accessibility'
import { PRIVACY } from '@/app/(legal)/_content/privacy'
import { TERMS } from '@/app/(legal)/_content/terms'
import { markdownPlainText } from '@/lib/articles/markdown'
import {
  documentBlocks,
  findPlaceholders,
  type LegalDocument,
} from '@/lib/legal/documents'

/**
 * The legal pages' house rules, held the same way the landing page holds its
 * copy rules.
 *
 * Two of these are load bearing.
 *
 * The placeholder inventory: a legal document ships with square bracket blanks
 * and every one has to be filled before it means anything, so the exact set is
 * written down. All three documents are currently filled, so every list is
 * empty; pasting a new draft that carries blanks fails this suite rather than
 * shipping quietly.
 *
 * The transparency note: both documents disclose that they have not yet been
 * reviewed by an attorney, and that note renders on the public page. Deleting
 * it is a decision for whoever has actually had a lawyer read these, so the
 * test refuses to let it disappear as a side effect of an edit, and checks the
 * admission rather than just the label.
 */

const DOCUMENTS: Array<[string, LegalDocument]> = [
  ['terms', TERMS],
  ['privacy', PRIVACY],
  ['accessibility', ACCESSIBILITY],
]

/**
 * Placeholders still open, per document. Update only when a blank is genuinely
 * filled or a new draft is pasted in, and say so in the pull request.
 */
const OPEN_PLACEHOLDERS: Record<string, string[]> = {
  terms: [],
  privacy: [],
  accessibility: [],
}

/** Collapse whitespace so a formatting change is not read as a wording change. */
const words = (s: string) => s.replace(/\s+/g, ' ').trim()

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

  it.each(DOCUMENTS)('%s parses into blocks the page can render', (_name, doc) => {
    expect(documentBlocks(doc).length).toBeGreaterThan(0)
  })

  it.each(DOCUMENTS)('%s renders no unfilled blanks to a reader', (_name, doc) => {
    // Belt and braces on the inventory above: whatever the parser produces,
    // the words a visitor actually sees carry no bracketed blank.
    expect(markdownPlainText(documentBlocks(doc))).not.toMatch(
      /\[[A-Z0-9][A-Z0-9 /&]*\]/,
    )
  })

  it('keeps the transparency note on both drafted documents', () => {
    for (const doc of [TERMS, PRIVACY]) {
      const quote = documentBlocks(doc).find((b) => b.kind === 'blockquote')
      expect(quote, `${doc.title} has the note as a blockquote`).toBeDefined()
      const text = markdownPlainText([quote!])
      expect(text).toContain('Transparency note:')
      // The disclosure itself, not just the label. A note that kept the
      // heading and lost the admission would pass a looser check. The two
      // documents differ only in agreement: terms "have", policy "has".
      expect(text).toMatch(/ha(ve|s) not yet been reviewed by an attorney/)
      expect(text).toContain('prepared with AI assistance')
    }
  })

  it('numbers the terms sections without skipping a heading level', () => {
    // The shared parser starts # at h2 for articles, so without the shift in
    // documentBlocks these would land at h3 under the page h1 and leave a hole
    // in the heading order.
    const headings = documentBlocks(TERMS).filter((b) => b.kind === 'heading')
    expect(headings.length).toBeGreaterThan(20)
    for (const h of headings) expect(h.level).toBe(2)
    expect(markdownPlainText([headings[0]])).toBe('1. The Service')
    expect(markdownPlainText([headings[headings.length - 1]])).toBe('Contact')
  })

  it('keeps the accessibility statement exactly as supplied', () => {
    expect(ACCESSIBILITY.title).toBe('Accessibility at Talvex')
    expect(ACCESSIBILITY.source).toBe(
      `Talvex is committed to making our platform usable by as many people as possible, including people with disabilities. We aim to conform to the Web Content Accessibility Guidelines (WCAG) 2.2 Level AA.

Our platform is designed and tested with keyboard navigation, screen reader compatibility, visible focus indicators, and sufficient color contrast in mind. Status information is always conveyed by text and icons, never by color alone. Accessibility is an ongoing effort, and some portions of the platform may not yet fully conform. We review accessibility as part of every release.

If you encounter an accessibility barrier, need assistance, or would like to request an accommodation, contact us at islamelsayed02@gmail.com. We will make reasonable efforts to provide the information or functionality you need through an alternative method, and we welcome feedback that helps us improve.

This statement was last reviewed on August 3, 2026.`,
    )
  })

  it('carries the drafted legal prose without rewording it', () => {
    // Spot checks across each document, including the clauses most likely to be
    // "tidied" by a well meaning edit: the all caps disclaimers, the PHI
    // prohibition, and the liability cap.
    const terms = words(TERMS.source)
    for (const clause of [
      'These Terms of Service (the "Terms") are a binding agreement between you and Islam Elsayed, doing business as Talvex',
      'Talvex is not a HIPAA covered entity or business associate by default and does not sign a BAA unless expressly agreed in a separate written document.',
      'THE SERVICE, INCLUDING ALL AI FEATURES, OUTPUT, AND SECURITY MEASURES, IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND',
      'WILL NOT EXCEED THE GREATER OF (i) THE AMOUNTS YOU PAID US FOR THE SERVICE IN THE TWELVE MONTHS PRECEDING THE EVENT GIVING RISE TO THE CLAIM, OR (ii) ONE HUNDRED US DOLLARS ($100).',
      'These Terms are governed by the laws of the State of New York',
    ]) {
      expect(terms, `terms clause missing: ${clause.slice(0, 48)}`).toContain(
        clause,
      )
    }

    const privacy = words(PRIVACY.source)
    for (const clause of [
      'We do not sell personal information and we do not use your content to train AI models.',
      'Do not submit sensitive personal information, and never submit protected health information, to AI features.',
      'We are based in the United States and process data in the United States.',
    ]) {
      expect(privacy, `privacy clause missing: ${clause.slice(0, 48)}`).toContain(
        clause,
      )
    }
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
