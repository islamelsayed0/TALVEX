/**
 * Pre paint theme resolution. Rendered as the first child of <body> so it
 * runs synchronously before anything paints: the stored choice wins, otherwise
 * dark, which is the product's primary mode (docs/design/handoff/README.md).
 * The OS preference is deliberately NOT consulted: the design is dark first, so
 * a first visit shows dark regardless of the system setting, and light is an
 * explicit opt in through the header toggle (which persists to localStorage).
 *
 * Kept as an inline script rather than a client component so there is no
 * flash of the wrong theme while React hydrates. The root <html> carries
 * suppressHydrationWarning because this mutates its data-theme attribute
 * before hydration.
 */
const THEME_SCRIPT = `(function () {
  try {
    var t = localStorage.getItem("talvex-theme");
    if (t !== "dark" && t !== "light") {
      t = "dark";
    }
    document.documentElement.dataset.theme = t;
  } catch (e) {
    document.documentElement.dataset.theme = "dark";
  }
})();`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />;
}
