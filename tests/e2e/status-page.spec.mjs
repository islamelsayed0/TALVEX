import assert from 'node:assert/strict'

import { chromium } from 'playwright'

/**
 * End to end checks for the public status page (BRD F9), written against the
 * base playwright package the repo already uses (there is no @playwright/test
 * runner yet; CI's end to end job is planned, see .github/workflows). Run it by
 * hand against a build pointed at the local Supabase stack with seeded data:
 *
 *   1. npm run db:start && npm run db:reset
 *   2. seed an enabled org (slug ENABLED_SLUG) with monitors + rollups, and a
 *      disabled org (slug DISABLED_SLUG), through the service role.
 *   3. build and start with the LOCAL Supabase url baked in (NEXT_PUBLIC_* are
 *      inlined at build time), then:
 *      BASE_URL=http://localhost:3200 ENABLED_SLUG=acme-demo \
 *      DISABLED_SLUG=private-demo node tests/e2e/status-page.spec.mjs
 *
 * The security boundary itself is proven at the database by
 * tests/isolation/status-page-isolation.test.ts; this asserts the page.
 */

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3200'
const ENABLED_SLUG = process.env.ENABLED_SLUG ?? 'acme-demo'
const DISABLED_SLUG = process.env.DISABLED_SLUG ?? 'private-demo'
const UNKNOWN_SLUG = 'never-existed-slug'

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()

  // 1. The enabled page renders the org name, its monitors, and the heatmap.
  const enabled = await page.goto(`${BASE_URL}/status/${ENABLED_SLUG}`)
  assert.equal(enabled?.status(), 200, 'enabled status page should return 200')
  const body = await page.content()
  assert.match(body, /Acme Corp/, 'shows the org name')
  assert.match(body, /Booking API/, 'shows a monitor name')
  assert.ok(
    (await page.locator('.bg-status-up').count()) > 0,
    'renders heatmap cells',
  )
  assert.doesNotMatch(body, /https:\/\/api\.acme\.com/, 'never leaks a monitor url')

  // 2. A disabled page 404s, indistinguishable from an unknown slug.
  const disabled = await page.goto(`${BASE_URL}/status/${DISABLED_SLUG}`)
  assert.equal(disabled?.status(), 404, 'disabled status page should 404')

  // 3. An unknown slug 404s the same way.
  const unknown = await page.goto(`${BASE_URL}/status/${UNKNOWN_SLUG}`)
  assert.equal(unknown?.status(), 404, 'unknown slug should 404')

  console.log('status page e2e: all checks passed')
} finally {
  await browser.close()
}
