/**
 * The legal documents: terms of service, privacy policy, accessibility
 * statement.
 *
 * Each one is stored as its raw markdown source next to the pages that render
 * it, and parsed through the same small parser the help articles use
 * (src/lib/articles/markdown). That parser produces a typed block structure
 * rather than an HTML string, so there is no dangerouslySetInnerHTML on these
 * pages either, and nothing in the pipeline can inject markup.
 *
 * Two rules the tests hold:
 *
 * 1. The prose is never edited here. It is drafted elsewhere and pasted in
 *    verbatim, headings, bold, and section numbering intact. Nothing in this
 *    module rewrites, wraps, or normalises the words.
 * 2. Unfilled placeholders are visible, never silent. Legal drafts arrive with
 *    square bracket blanks ([COMPANY NAME], [DATE]) and shipping one unfilled
 *    is the failure mode worth engineering against, so findPlaceholders reads
 *    them straight out of the source and a test asserts the list matches what
 *    we knowingly accepted.
 */

import { parseMarkdown, type MarkdownBlock } from '@/lib/articles/markdown'

export type LegalDocument = {
  /** Page h1 and metadata title. */
  title: string
  /** One line description for page metadata. */
  description: string
  /** Rendered under the h1, for example "Last updated 3 August 2026". */
  effective?: string
  /** Raw markdown, pasted verbatim from the drafted document. */
  source: string
}

/**
 * Square bracket blanks awaiting a real value, in document order, deduplicated.
 *
 * Deliberately narrow: uppercase, digits, spaces, slashes, and ampersands
 * only. That matches drafting convention ([COMPANY NAME], [DATE]) and will not
 * fire on ordinary bracketed prose or on a markdown link's [text](href).
 */
export function findPlaceholders(source: string): string[] {
  const found = source.matchAll(/\[([A-Z0-9][A-Z0-9 /&]*)\](?!\()/g)
  return [...new Set([...found].map((m) => m[0]))]
}

/** Parse a document's markdown into blocks for the renderer. */
export function documentBlocks(doc: LegalDocument): MarkdownBlock[] {
  return parseMarkdown(doc.source)
}
