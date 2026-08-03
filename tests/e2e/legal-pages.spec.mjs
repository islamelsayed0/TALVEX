import assert from 'node:assert/strict'

import { chromium } from 'playwright'

/**
 * End to end checks for the public legal pages, in the same hand run idiom as
 * the other specs here (base playwright, no runner yet):
 *
 *   BASE_URL=http://localhost:3000 node tests/e2e/legal-pages.spec.mjs
 *
 * Asserts each route renders its h1 to a signed out visitor, that the footer
 * links reach all three, and that the sign in screen's acceptance notice
 * actually navigates to the terms. Visual verification here means navigating
 * to a real URL, per the repo rule, so nothing below is mocked.
 */

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'

const PAGES = [
  { path: '/terms', h1: 'Terms of Service', title: 'Terms of Service — Talvex' },
  { path: '/privacy', h1: 'Privacy Policy', title: 'Privacy Policy — Talvex' },
  {
    path: '/accessibility',
    h1: 'Accessibility at Talvex',
    title: 'Accessibility at Talvex — Talvex',
  },
]

const browser = await chromium.launch({ headless: true })
try {
  // A fresh context with no storage state: this is a signed out visitor, which
  // is the whole point. If the proxy ever starts protecting these, this fails.
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  })
  const page = await context.newPage()

  // 1. Each route renders, to a signed out visitor, with the right h1.
  for (const spec of PAGES) {
    const res = await page.goto(`${BASE_URL}${spec.path}`, {
      waitUntil: 'networkidle',
    })
    assert.equal(res?.status(), 200, `${spec.path} should return 200`)
    assert.ok(
      !page.url().includes('/sign-in'),
      `${spec.path} must not redirect a signed out visitor to sign in`,
    )

    const h1 = page.locator('h1')
    assert.equal(await h1.count(), 1, `${spec.path} has exactly one h1`)
    assert.equal(
      (await h1.innerText()).trim(),
      spec.h1,
      `${spec.path} renders its h1`,
    )
    assert.equal(await page.title(), spec.title, `${spec.path} sets its title`)
    console.log(`${spec.path}: h1 "${spec.h1}" renders`)
  }

  // 2. The accessibility statement is on the page, verbatim enough to prove it
  //    is the supplied document and not a summary of it.
  const a11yText = await page.evaluate(() => document.body.innerText)
  for (const phrase of [
    'Web Content Accessibility Guidelines (WCAG) 2.2 Level AA',
    'never by color alone',
    '[ACCESSIBILITY EMAIL]',
  ]) {
    assert.ok(
      a11yText.includes(phrase),
      `accessibility page contains: ${phrase}`,
    )
  }

  // 3. The footer reaches all three from a public page.
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' })
  const footer = page.locator('footer')
  for (const [label, path] of [
    ['Terms', '/terms'],
    ['Privacy', '/privacy'],
    ['Accessibility', '/accessibility'],
  ]) {
    const link = footer.getByRole('link', { name: label, exact: true })
    assert.ok(await link.count(), `footer has a ${label} link`)
    assert.equal(
      await link.first().getAttribute('href'),
      path,
      `footer ${label} points at ${path}`,
    )
  }
  console.log('footer links reach all three legal pages')

  // 4. The sign in acceptance notice really navigates to the terms.
  await page.goto(`${BASE_URL}/sign-in`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.cl-rootBox', { timeout: 20000 })
  const notice = page.getByText('By continuing you agree to the')
  assert.ok(await notice.count(), 'sign in shows the acceptance notice')
  await page.getByRole('link', { name: 'Terms of Service' }).click()
  await page.waitForURL(/\/terms$/, { timeout: 15000 })
  console.log('sign in acceptance notice reaches the terms')

  // 5. No horizontal scroll on a phone, same bar the landing page holds.
  const phone = await context.newPage()
  await phone.setViewportSize({ width: 390, height: 844 })
  for (const spec of PAGES) {
    await phone.goto(`${BASE_URL}${spec.path}`, { waitUntil: 'networkidle' })
    const overflow = await phone.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    )
    assert.ok(overflow <= 0, `${spec.path} no sideways scroll (${overflow}px)`)
  }

  console.log('legal-pages.spec.mjs: all checks passed')
} finally {
  await browser.close()
}
