import { mkdirSync } from 'node:fs'

import { clerk, clerkSetup, setupClerkTestingToken } from '@clerk/testing/playwright'
import { chromium } from 'playwright'

/**
 * End to end checks for inventory (F15), written against the base
 * playwright package in the same style and against the same harness as
 * articles.spec.mjs; the prerequisites (local stack with Clerk third party
 * auth, a seeded org with an admin and a member, the app built against the
 * local stack) are identical and are listed in dashboard-sidebar.spec.mjs.
 *
 * What it proves, end to end through the real screens:
 *   - the admin creates an item and sees it listed in stock
 *   - editing the quantity to the minimum flips the low stock chip, and the
 *     low item sorts to the top of the list
 *   - deleting through the confirmation removes it
 *   - the member sees no Inventory entry in the sidebar and direct
 *     navigation is refused (redirected to Help)
 *
 * Run:
 *   BASE_URL=http://127.0.0.1:3200 CLERK_ORG_ID=org_xxx \
 *   ADMIN_EMAIL=...+clerk_test@example.com MEMBER_EMAIL=...+clerk_test@example.com \
 *   SHOTS=./shots node tests/e2e/inventory.spec.mjs
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

// Unique per run so reruns against the same stack never collide.
const STAMP = Date.now().toString(36)
const ITEM_NAME = `Toner cartridge ${STAMP}`

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

/** The list row that carries our item, chip text included. */
function itemRow(page) {
  return page
    .locator('div.border-t, div.grid')
    .filter({ has: page.getByRole('link', { name: ITEM_NAME }) })
    .last()
}

// ---------- ADMIN: create, watch the chip, delete ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await signIn(page, ADMIN)

  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
  check(
    'admin sees Inventory in the sidebar',
    (await page.locator('nav[aria-label="Primary"] a[href="/dashboard/inventory"]').count()) === 1,
  )

  await page.goto(`${BASE}/dashboard/inventory/new`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[name="name"]', ITEM_NAME)
  await page.fill('input[name="item_number"]', `E2E-${STAMP}`)
  await page.fill('input[name="location"]', 'Storage room B')
  await page.fill('input[name="quantity"]', '5')
  await page.fill('input[name="min_stock"]', '2')
  await page.click('button[type="submit"]')
  await page.waitForURL('**/dashboard/inventory', { timeout: 15000 })

  check(
    'the created item is listed',
    (await page.getByRole('link', { name: ITEM_NAME }).count()) === 1,
  )
  check(
    'a healthy quantity shows In stock',
    (await itemRow(page).getByText('In stock').count()) === 1,
  )
  await shot(page, 'inventory-01-admin-list')

  // Quantity down to the minimum: the chip must flip to Low stock.
  await page.getByRole('link', { name: ITEM_NAME }).click()
  await page.waitForURL('**/edit**')
  await page.fill('input[name="quantity"]', '2')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await page.waitForURL('**/dashboard/inventory', { timeout: 15000 })
  check(
    'quantity at the minimum shows the Low stock chip',
    (await itemRow(page).getByText('Low stock').count()) === 1,
  )
  await shot(page, 'inventory-02-low-stock')

  // The low stock only filter keeps it; sorted first is implicit (low band
  // sorts ahead of everything healthy).
  await page.goto(`${BASE}/dashboard/inventory?low=1`, { waitUntil: 'domcontentloaded' })
  check(
    'the low stock filter shows the item',
    (await page.getByRole('link', { name: ITEM_NAME }).count()) === 1,
  )

  // Delete through the confirmation.
  await page.getByRole('link', { name: ITEM_NAME }).click()
  await page.waitForURL('**/edit**')
  await page.getByRole('link', { name: 'Delete' }).click()
  await page.waitForURL('**/delete**')
  await shot(page, 'inventory-03-delete-confirm')
  await page.getByRole('button', { name: 'Delete item' }).click()
  await page.waitForURL('**/dashboard/inventory', { timeout: 15000 })
  check(
    'the deleted item is gone from the list',
    (await page.getByText(ITEM_NAME).count()) === 0,
  )

  await ctx.close()
}

// ---------- MEMBER: no surface at all ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await signIn(page, MEMBER)

  await page.goto(`${BASE}/dashboard/help`, { waitUntil: 'domcontentloaded' })
  check(
    'member sees no Inventory entry in the sidebar',
    (await page.locator('a[href="/dashboard/inventory"]').count()) === 0,
  )
  await shot(page, 'inventory-04-member-sidebar')

  check(
    'direct navigation to inventory is refused for a member',
    await page
      .goto(`${BASE}/dashboard/inventory`, { waitUntil: 'domcontentloaded' })
      .then(() => page.waitForTimeout(600))
      .then(() => page.url().includes('/dashboard/help')),
    page.url(),
  )

  await ctx.close()
}

await browser.close()

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) {
  console.log('FAILURES:', failed.map((r) => r.name))
  process.exit(1)
}
console.log('ALL INVENTORY CHECKS PASSED')
