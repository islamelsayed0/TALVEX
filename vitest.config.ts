import { configDefaults, defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    // tests/e2e holds Playwright scripts run against a live app, not Vitest
    // units. They match the default spec glob, so exclude them explicitly.
    exclude: [...configDefaults.exclude, 'tests/e2e/**'],
  },
  resolve: {
    alias: {
      // The real 'server-only' package throws outside a React Server
      // Components build, which is exactly what we want in the app and
      // exactly wrong in a node test run. Tests import server modules for
      // their pure logic; the RSC boundary is Next's to enforce, not
      // Vitest's. The stub is an empty module.
      'server-only': path.resolve(__dirname, 'tests/helpers/server-only-stub.ts'),
      '@': path.resolve(__dirname, 'src'),
    },
  },
})
