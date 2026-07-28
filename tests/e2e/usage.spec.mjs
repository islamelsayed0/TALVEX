import { mkdirSync } from 'node:fs'

import { clerk, clerkSetup, setupClerkTestingToken } from '@clerk/testing/playwright'
import { chromium } from 'playwright'

/**
 * End to end checks for the usage settings screen (F11). Written against the
 * base playwright package the repo already uses, in the same style and
 * against the same harness as dashboard-sidebar.spec.mjs; the prerequisites
 * (local stack with Clerk third party auth, a seeded org with an admin and a
 * member, the app built against the local stack) are identical and are
 * listed in that spec's header comment.
 *
 * What it proves: an admin sees the Usage tab and the screen renders its
 * three sections plus the display only footnote; a member neither sees the
 * tab nor reaches the screen by URL (requireAdmin redirects them to Help).
 *
 * Run:
 *   BASE_URL=http://127.0.0.1:3200 CLERK_ORG_ID=org_xxx \
 *   ADMIN_EMAIL=...+clerk_test@example.com MEMBER_EMAIL=...+clerk_test@example.com \
 *   SHOTS=./shots node tests/e2e/usage.spec.mjs
 */

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3200'
const ORG_ID = process.env.CLERK_ORG_ID
const ADMIN = process.env.ADMIN_EMAIL
const MEMBER = process.env.MEMBER_EMAIL
const OUT = process.env.SHOTS ?? './shots'

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

  await page.goto(`${BASE}/dashboard/settings/api-keys`, { waitUntil: 'domcontentloaded' })
  const usageTab = page.locator('nav[aria-label="Settings sections"] a[href="/dashboard/settings/usage"]')
  check('admin sees the Usage tab in settings', (await usageTab.count()) === 1)

  await page.goto(`${BASE}/dashboard/settings/usage`, { waitUntil: 'domcontentloaded' })
  // The auto set flow may refresh once on the very first visit; settle first.
  await page.waitForTimeout(1200)
  check('AI usage section renders', (await page.getByRole('heading', { name: /This month/ }).count()) === 1)
  check('Monitor checks section renders', (await page.getByRole('heading', { name: 'Monitor checks' }).count()) === 1)
  check('Seats section renders', (await page.getByRole('heading', { name: 'Seats' }).count()) === 1)
  check('timezone select present', (await page.locator('select[name="timezone"]').count()) === 1)
  check(
    'display only footnote present, no limit or plan language',
    (await page.getByText('Usage is shown for information; nothing is limited or billed.').count()) === 1,
  )
  await shot(page, 'usage-01-admin')

  await ctx.close()
}

// ---------- MEMBER ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await signIn(page, MEMBER)

  await page.goto(`${BASE}/dashboard/help`, { waitUntil: 'domcontentloaded' })
  check(
    'member sees no Usage link anywhere',
    (await page.locator('a[href="/dashboard/settings/usage"]').count()) === 0,
  )

  await page.goto(`${BASE}/dashboard/settings/usage`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(600)
  check(
    'direct navigation is refused: member lands on Help',
    page.url().includes('/dashboard/help'),
    page.url(),
  )
  await shot(page, 'usage-02-member-redirected')

  await ctx.close()
}

await browser.close()

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) {
  console.log('FAILURES:', failed.map((r) => r.name))
  process.exit(1)
}
console.log('ALL USAGE CHECKS PASSED')
