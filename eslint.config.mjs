import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import jsxA11y from "eslint-plugin-jsx-a11y";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Accessibility rules on every component, in the lint job CI already runs.
  //
  // /accessibility commits us to WCAG 2.2 AA. The axe spec proves the pages we
  // point it at; this catches the classes of mistake that never reach a scanned
  // page, in the editor, before the PR: an icon only button with no label, an
  // image with no alt, a click handler on a div, a label with no control.
  //
  // eslint-config-next already enables a handful of these. Taking the plugin's
  // full recommended set rather than that subset is deliberate: the narrower
  // list is chosen for framework ergonomics, not for meeting a standard we
  // have published.
  //
  // Rules only, no `plugins` key: eslint-config-next has already registered
  // jsx-a11y, and flat config treats a second registration of the same plugin
  // name as a hard error rather than a merge.
  {
    files: ["src/**/*.tsx"],
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      // One rule is configured rather than taken as shipped, and this is the
      // reason.
      //
      // A region that scrolls must be reachable by keyboard, or its content
      // below the fold cannot be read without a mouse. That is WCAG 2.1.1 and
      // axe fails it as `scrollable-region-focusable`, serious. The fix is
      // tabIndex={0} on the scroll container.
      //
      // no-noninteractive-tabindex does not model scroll containers, so it
      // reads that same fix as a mistake. Taken as shipped, the two tools
      // require opposite things and one of them has to be silenced on every
      // scrollable list we ever write.
      //
      // Allowing role="group" resolves it narrowly: a bare div still cannot
      // take a tabIndex, but a container that has declared what it is may.
      // This is not a blanket exception, and it is the only rule changed.
      "jsx-a11y/no-noninteractive-tabindex": [
        "error",
        { tags: [], roles: ["tabpanel", "group"], allowExpressionValues: true },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The design handoff prototype bundle, which is gitignored but sits in
    // the working tree. ESLint does not read .gitignore, so ignoring it there
    // is not enough: without this line `npm run lint` reports two errors and
    // eight warnings from a generated export that is not our source, and a
    // lint run that is always red is a lint run nobody reads. CI never saw
    // this, because CI only ever checks out tracked files.
    "design_handoff_talvex_app/**",
  ]),
  // All application logging goes through src/lib/log.ts, which emits one line
  // of JSON with a fixed field set and a closed union of event names. This
  // rule is what keeps that seam single: without it the module is a
  // convention, and the next feature quietly adds a bare console.error whose
  // wording nobody can filter on. src/lib/log.ts is the one exception because
  // it is the module that actually writes to the console.
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    rules: { "no-console": "error" },
  },
  {
    files: ["src/lib/log.ts"],
    rules: { "no-console": "off" },
  },
]);

export default eslintConfig;
