import type { LegalDocument } from '@/lib/legal/documents'

/**
 * The accessibility statement, verbatim as supplied.
 *
 * The supplied document opens with "## Accessibility at Talvex". That line is
 * the document's own title, so it is lifted into `title` and rendered as the
 * page h1 rather than repeated as a heading inside the body. Every remaining
 * word is untouched.
 *
 * Two placeholders are still open: [ACCESSIBILITY EMAIL] and [DATE]. They are
 * listed in tests/legal-pages.test.ts, which fails the moment the set of open
 * placeholders drifts from what was knowingly accepted.
 *
 * The WCAG 2.2 AA claim this page makes is not decorative. The accessibility
 * engineering pass on the design system branch is what makes it honest.
 */
export const ACCESSIBILITY: LegalDocument = {
  title: 'Accessibility at Talvex',
  description:
    'How Talvex approaches accessibility, the standard we work toward, and how to reach us about a barrier.',
  source: `Talvex is committed to making our platform usable by as many people as possible, including people with disabilities. We aim to conform to the Web Content Accessibility Guidelines (WCAG) 2.2 Level AA.

Our platform is designed and tested with keyboard navigation, screen reader compatibility, visible focus indicators, and sufficient color contrast in mind. Status information is always conveyed by text and icons, never by color alone. Accessibility is an ongoing effort, and some portions of the platform may not yet fully conform. We review accessibility as part of every release.

If you encounter an accessibility barrier, need assistance, or would like to request an accommodation, contact us at [ACCESSIBILITY EMAIL]. We will make reasonable efforts to provide the information or functionality you need through an alternative method, and we welcome feedback that helps us improve.

This statement was last reviewed on [DATE].`,
}
