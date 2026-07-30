import assert from 'node:assert/strict'

import { chromium } from 'playwright'

/**
 * End to end checks for the public landing page, in the same hand run idiom as
 * the other specs here (base playwright, no runner yet):
 *
 *   BASE_URL=http://localhost:3000 node tests/e2e/landing.spec.mjs
 *
 * Asserts the page renders, the product shots resolve, the sign up CTA reaches
 * the Clerk widget, the rendered text keeps the no hyphen rule, and a phone
 * viewport does not scroll sideways.
 */

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

  // 1. The page renders with the hero and all four product shots.
  const res = await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' })
  assert.equal(res?.status(), 200, 'landing should return 200')
  assert.match(await page.content(), /One .*calm.* place/s, 'hero renders')
  for (const shot of [
    'dashboard-shot.png',
    'chat-shot.png',
    'status-shot.png',
    'inventory-shot.png',
  ]) {
    const img = page.locator(`img[src*="${shot}"]`).first()
    assert.ok(await img.count(), `${shot} is on the page`)
    const ok = await img.evaluate(
      (el) => el.complete && el.naturalWidth > 0,
    )
    assert.ok(ok, `${shot} actually loaded`)
  }

  // 2. Rendered prose keeps the no hyphen rule (en dashes are fine).
  const text = await page.evaluate(() => document.body.innerText)
  const hyphenated = text.split(/\s+/).filter((w) => w.includes('-'))
  assert.deepEqual(hyphenated, [], 'no hyphens in rendered landing text')

  // 3. The signed out sign up CTA really reaches Clerk.
  await page.getByRole('link', { name: 'Start free' }).first().click()
  await page.waitForURL(/\/sign-up/, { timeout: 15000 })
  await page.waitForSelector('.cl-rootBox', { timeout: 20000 })
  console.log('sign up CTA reaches the Clerk widget')

  // 4. A phone viewport never scrolls sideways.
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await phone.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' })
  const overflow = await phone.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  assert.ok(overflow <= 0, `no horizontal scroll at 390px (overflow ${overflow}px)`)

  console.log('landing.spec.mjs: all checks passed')
} finally {
  await browser.close()
}
