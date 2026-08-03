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
    (await page.locator('.heat-up, .heat-partial, .heat-down, .heat-none').count()) > 0,
    'renders heatmap cells',
  )
  assert.doesNotMatch(body, /https:\/\/api\.acme\.com/, 'never leaks a monitor url')

  // 1b. No state is carried by color alone (the /accessibility commitment).
  //     Every monitor row names its state in words, and the heatmap fills
  //     carry a pattern as well as a hue.
  const rowStates = await page
    .locator('section >> text=/^(Operational|Down|No data yet)$/')
    .count()
  assert.ok(rowStates > 0, 'monitor rows name their state in words')

  const patterned = await page.evaluate(() => {
    const cell = document.querySelector('.heat-partial, .heat-down')
    if (!cell) return 'no-downtime-cells'
    return getComputedStyle(cell).backgroundImage
  })
  if (patterned !== 'no-downtime-cells') {
    assert.match(
      patterned,
      /repeating-linear-gradient/,
      'downtime cells carry a fill pattern, not only a color',
    )
  }

  for (const label of ['no downtime', 'partial downtime', 'no data']) {
    assert.ok(body.includes(label), `heatmap key explains "${label}"`)
  }

  // Every status mark is decorative. That is the whole design: the mark is a
  // redundant second channel for sighted readers and the text beside it is
  // what carries the state, so a mark that is not aria-hidden means some
  // state is leaning on the mark to be understood.
  const exposedMarks = await page.evaluate(
    () =>
      [...document.querySelectorAll('span, div')].filter((el) => {
        const c = el.className
        if (typeof c !== 'string') return false
        const isMark =
          /bg-status-(up|down|pending)\b/.test(c) &&
          !/heat-/.test(c) &&
          el.textContent?.trim() === ''
        return isMark && el.getAttribute('aria-hidden') === null
      }).length,
  )
  assert.equal(exposedMarks, 0, 'every status mark is aria-hidden')

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
