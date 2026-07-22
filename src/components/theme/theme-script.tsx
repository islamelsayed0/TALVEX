/**
 * Pre paint theme resolution. Rendered as the first child of <body> so it
 * runs synchronously before anything paints: stored choice first, then the
 * system preference, then dark, which is the product default.
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
      t = window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark";
    }
    document.documentElement.dataset.theme = t;
  } catch (e) {
    document.documentElement.dataset.theme = "dark";
  }
})();`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />;
}
