import type { LegalDocument } from '@/lib/legal/documents'

/**
 * Terms of Service.
 *
 * AWAITING COPY. The drafted document was not supplied with this task, and
 * legal language is the one thing on this branch that must not be written by
 * whoever is wiring up the page. Paste the drafted markdown into `source`
 * verbatim, headings, bold, and section numbering intact, set `effective`, and
 * delete this paragraph. The route, the parser, the renderer, the metadata,
 * the footer link, and the sign in notice are all already pointing here, so
 * dropping in the text is the only step left.
 *
 * Until then the page renders the pending notice rather than invented terms.
 * tests/legal-pages.test.ts asserts this file holds no prose while it is
 * pending, so nothing placeholder shaped can quietly become the shipped terms.
 */
export const TERMS: LegalDocument = {
  title: 'Terms of Service',
  description: 'The terms that govern use of the Talvex platform.',
  source: '',
}
