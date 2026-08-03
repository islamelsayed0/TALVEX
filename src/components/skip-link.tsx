/**
 * The skip link: the first focusable thing on every page, and invisible until
 * it has focus.
 *
 * Without it, reaching the content of a dashboard page by keyboard means
 * tabbing through the whole sidebar first, on every page, every time. WCAG
 * 2.4.1. It is the cheapest accessibility win in the app and it was missing
 * entirely.
 *
 * Rendered in the root layout, so it precedes everything in the document
 * order and one instance covers every route. Its target is `#main-content`,
 * which every page's <main> carries.
 *
 * Kept out of sight with a clip rather than display:none or visibility:hidden,
 * because both of those remove an element from the focus order, which would
 * make this link unreachable by the exact input method it exists to serve. On
 * focus it drops into the top left corner as a real, visible control.
 */
export function SkipLink() {
  return (
    <a
      href="#main-content"
      className="sr-only rounded-button bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground focus-visible:not-sr-only focus-visible:fixed focus-visible:top-3 focus-visible:left-3 focus-visible:z-[100]"
    >
      Skip to main content
    </a>
  )
}
