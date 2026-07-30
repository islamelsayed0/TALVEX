import { mkdirSync } from 'node:fs'

import { clerk, clerkSetup, setupClerkTestingToken } from '@clerk/testing/playwright'
import { chromium } from 'playwright'

/**
 * End to end checks for the daily digest settings (migration 017). Same
 * harness, style, and prerequisites as usage.spec.mjs: a local stack with
 * Clerk third party auth, a seeded org with an admin and a member, and the app
 * built against that stack.
 *
 * What it proves: an admin sees the digest controls, can turn the digest on
 * and set a time, and the saved state survives a reload; a member sees no
 * digest control at all, because the whole notifications screen is admin only.
 *
 * What it deliberately does NOT do: send anything. Sending is proved by
 * tests/digest.test.ts (composition and the due check) and by
 * tests/isolation/digest-isolation.test.ts (the grants and the cross org
 * proof). Driving a real email from a browser test would prove less and
 * depend on a provider.
 *
 * Run:
 *   BASE_URL=http://127.0.0.1:3200 CLERK_ORG_ID=org_xxx \
 *   ADMIN_EMAIL=...+clerk_test@example.com MEMBER_EMAIL=...+clerk_test@example.com \
 *   SHOTS=./shots node tests/e2e/digest.spec.mjs
 */

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3200'
const ORG_ID = process.env.CLERK_ORG_ID
const ADMIN = process.env.ADMIN_EMAIL
const MEMBER = process.env.MEMBER_EMAIL
const OUT = process.env.SHOTS ?? './shots'
const PAGE = '/dashboard/settings/notifications'

if (!ORG_ID || !ADMIN || !MEMBER) {
  throw new Error('Set CLERK_ORG_ID, ADMIN_EMAIL, MEMBER_EMAIL')
}
mkdirSync(OUT, { recursive: true })

const results = []
function check(name, ok, extra = '') {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
}

await clerkSetup({
  publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  secretKey: process.env.CLERK_SECRET_KEY,
})

const browser = await chromium.launch({ headless: true })

async function signIn(page, email) {
  await setupClerkTestingToken({ page })
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' })
  await clerk.loaded({ page })
  await clerk.signIn({ page, signInParams: { strategy: 'email_code', identifier: email } })
  await page.evaluate((orgId) => window.Clerk.setActive({ organization: orgId }), ORG_ID)
  await page.waitForTimeout(600)
}

async function shot(page, name) {
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true })
}

// ---------- ADMIN ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await signIn(page, ADMIN)

  await page.goto(`${BASE}${PAGE}`, { waitUntil: 'domcontentloaded' })

  const toggle = page.locator('input[name="digest_enabled"]')
  const time = page.locator('input[name="digest_send_time"]')
  check('digest section renders', (await page.getByRole('heading', { name: 'Daily digest' }).count()) === 1)
  check('enable toggle present', (await toggle.count()) === 1)
  check('time input present', (await time.count()) === 1)

  // The three promises the copy has to make, in plain language.
  check(
    'copy says a quiet day means no email',
    (await page.getByText('If there is nothing that needs you, there is no email.').count()) === 1,
  )
  check(
    'copy names the timezone the send time is read in',
    (await page.getByText(/timezone,\s*\S+\//).count()) === 1,
  )
  check(
    'copy is honest about the cadence rather than promising the minute',
    (await page.getByText(/a few minutes after/).count()) === 1,
  )

  // No packaging language anywhere on the screen: the digest ships ungated.
  const body = (await page.locator('main').innerText()).toLowerCase()
  check(
    'no plan, upgrade, or lock language on the screen',
    !/\bupgrade\b|\bpaid plan\b|\bpro plan\b|\blocked\b/.test(body),
  )

  // Turn it on and set a time.
  await toggle.check()
  await time.fill('07:30')
  await page.getByRole('button', { name: 'Save digest settings' }).click()
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(600)
  check(
    'save is confirmed',
    (await page.getByText(/Saved\. Your digest settings take effect/).count()) === 1,
  )
  await shot(page, 'digest-01-admin-saved')

  // The real assertion: it persisted, not just echoed back.
  await page.goto(`${BASE}${PAGE}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(400)
  check('enabled state persisted across a reload', await page.locator('input[name="digest_enabled"]').isChecked())
  check(
    'send time persisted across a reload',
    (await page.locator('input[name="digest_send_time"]').inputValue()) === '07:30',
    await page.locator('input[name="digest_send_time"]').inputValue(),
  )

  // And it can be turned back off, so the screen is not a one way door.
  await page.locator('input[name="digest_enabled"]').uncheck()
  await page.getByRole('button', { name: 'Save digest settings' }).click()
  await page.waitForTimeout(600)
  await page.goto(`${BASE}${PAGE}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(400)
  check(
    'digest can be turned back off',
    !(await page.locator('input[name="digest_enabled"]').isChecked()),
  )

  await ctx.close()
}

// ---------- MEMBER ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await signIn(page, MEMBER)

  await page.goto(`${BASE}/dashboard/help`, { waitUntil: 'domcontentloaded' })
  check(
    'member sees no notifications settings link',
    (await page.locator(`a[href="${PAGE}"]`).count()) === 0,
  )

  await page.goto(`${BASE}${PAGE}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(600)
  check(
    'direct navigation is refused: member lands on Help',
    page.url().includes('/dashboard/help'),
    page.url(),
  )
  check(
    'member never sees a digest control',
    (await page.locator('input[name="digest_enabled"]').count()) === 0,
  )
  await shot(page, 'digest-02-member-redirected')

  await ctx.close()
}

await browser.close()

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) {
  console.log('FAILURES:', failed.map((r) => r.name))
  process.exit(1)
}
console.log('ALL DIGEST CHECKS PASSED')
