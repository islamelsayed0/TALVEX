import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
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
