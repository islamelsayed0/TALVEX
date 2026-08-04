import { mkdirSync } from 'node:fs'

import { clerk, clerkSetup, setupClerkTestingToken } from '@clerk/testing/playwright'
import { chromium } from 'playwright'

/**
 * End to end checks for the dashboard left sidebar (the shell recomposition).
 * Written against the base playwright package the repo already uses, in the
 * same style as status-page.spec.mjs (there is no @playwright/test runner yet).
 *
 * It signs in a real Clerk test-mode session for an admin and a member, sets
 * the seeded organization active so the session token carries the org claim RLS
 * reads, then drives the running app and both asserts the role aware nav item
 * sets and screenshots every dashboard screen plus the collapsed and narrow
 * overlay states. This is the binding visual verification for the shell.
 *
 * Prerequisites (see the sidebar PR description for the exact commands):
 *   1. npm run db:start, then add [auth.third_party.clerk] to supabase/config.toml
 *      pointing at the instance domain and restart, so the local stack verifies
 *      Clerk tokens.
 *   2. Provision a Clerk org with an admin user and a member user, and seed a
 *      matching organizations row (clerk_org_id) plus two org_members rows and
 *      some monitors/incidents/tickets into the local database.
 *   3. Build and start the app with the LOCAL Supabase url/key baked in
 *      (NEXT_PUBLIC_* are inlined at build time) and the real test Clerk keys.
 *
 * Then, with the Clerk keys in the environment:
 *   BASE_URL=http://127.0.0.1:3200 CLERK_ORG_ID=org_xxx \
 *   ADMIN_EMAIL=...+clerk_test@example.com MEMBER_EMAIL=...+clerk_test@example.com \
 *   SHOTS=./shots node tests/e2e/dashboard-sidebar.spec.mjs
 */

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3200'
const ORG_ID = process.env.CLERK_ORG_ID
const ADMIN = process.env.ADMIN_EMAIL
const MEMBER = process.env.MEMBER_EMAIL
const MON = process.env.MON_ID ?? ''
const INC = process.env.INC_ID ?? ''
const TIX = process.env.TIX_ID ?? ''
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
  // Test-mode email code (fixed 424242) for a +clerk_test address. The seeded
  // org is the user's only membership, so it becomes active on sign in; the
  // explicit setActive keeps it correct even if that ever changes.
  await clerk.signIn({ page, signInParams: { strategy: 'email_code', identifier: email } })
  await page.evaluate((orgId) => window.Clerk.setActive({ organization: orgId }), ORG_ID)
  await page.waitForTimeout(600)
}

async function shot(page, name) {
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false })
}

async function navLabels(page) {
  return (await page.locator('nav[aria-label="Primary"] a').allInnerTexts())
    .map((s) => s.trim())
    .filter(Boolean)
}

// ---------- ADMIN ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await signIn(page, ADMIN)

  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
  await shot(page, 'admin-01-overview')

  const labels = await navLabels(page)
  check(
    'admin nav has Overview/Monitors/Incidents/Tickets/Documents/Inventory/Help',
    ['Overview', 'Monitors', 'Incidents', 'Tickets', 'Documents', 'Inventory', 'Help'].every((l) => labels.some((x) => x.includes(l))),
    JSON.stringify(labels),
  )
  check('admin sees Settings entry', (await page.locator('a[href="/dashboard/settings/api-keys"]').count()) > 0)

  const routes = [
    ['admin-02-monitors', `${BASE}/dashboard/monitors`],
    ['admin-03-monitor-detail', `${BASE}/dashboard/monitors/${MON}`],
    ['admin-04-monitor-new', `${BASE}/dashboard/monitors/new`],
    ['admin-05-incidents', `${BASE}/dashboard/incidents`],
    ['admin-06-incident-detail', `${BASE}/dashboard/incidents/${INC}`],
    ['admin-07-tickets', `${BASE}/dashboard/tickets`],
    ['admin-08-ticket-detail', `${BASE}/dashboard/tickets/${TIX}`],
    ['admin-09-help', `${BASE}/dashboard/help`],
    ['admin-10-chat', `${BASE}/dashboard/chat`],
    ['admin-11-settings-api-keys', `${BASE}/dashboard/settings/api-keys`],
    ['admin-12-settings-notifications', `${BASE}/dashboard/settings/notifications`],
  ]
  for (const [name, url] of routes) {
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await shot(page, name)
  }

  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Collapse sidebar' }).click()
  await page.waitForTimeout(350)
  await shot(page, 'admin-13-collapsed')
  const collapsedWidth = await page.locator('aside').evaluate((el) => el.getBoundingClientRect().width)
  check('collapsed rail is narrow (<=80px)', collapsedWidth <= 80, `w=${Math.round(collapsedWidth)}`)
  // Navigate the way the app does: a client-side Link click, which keeps the
  // Next layout (and its collapse state) mounted. A full page load would reset
  // it, which is expected and not what "persists within the session" means.
  await page.locator('aside nav[aria-label="Primary"] a[href="/dashboard/incidents"]').click()
  await page.waitForURL('**/dashboard/incidents')
  await page.waitForTimeout(300)
  const stillCollapsed = await page.locator('aside').evaluate((el) => el.getBoundingClientRect().width)
  check('collapse persists across navigation', stillCollapsed <= 80, `w=${Math.round(stillCollapsed)}`)
  await shot(page, 'admin-14-collapsed-persisted-incidents')

  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(300)
  const pill = page.getByRole('button', { name: /ask talvext/i })
  if (await pill.count()) {
    await pill.first().click()
    await page.waitForTimeout(500)
    check('chat popup opens', (await page.getByRole('dialog').count()) > 0)
    await shot(page, 'admin-15-chat-popup')
  } else {
    check('chat popup trigger present', false, 'pill not found')
  }

  await page.setViewportSize({ width: 500, height: 900 })
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(300)
  await shot(page, 'admin-16-narrow-closed')
  await page.getByRole('button', { name: 'Open menu' }).click()
  await page.waitForTimeout(350)
  check('narrow overlay opens with nav', (await navLabels(page)).length >= 5)
  await shot(page, 'admin-17-narrow-overlay-open')
  await page.getByRole('button', { name: 'Close menu' }).click()
  await page.waitForTimeout(350)
  // The overlay (and only it) owns the "Close menu" scrim; the desktop aside is
  // display:none at this width but still in the DOM, so assert on the scrim.
  check('narrow overlay closes', (await page.locator('button[aria-label="Close menu"]').count()) === 0)

  await ctx.close()
}

// ---------- MEMBER ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await signIn(page, MEMBER)

  await page.goto(`${BASE}/dashboard/help`, { waitUntil: 'domcontentloaded' })
  await shot(page, 'member-01-help')
  const labels = await navLabels(page)
  check('member nav has Home + My requests + Documents',
    ['Home', 'My requests', 'Documents'].every((l) => labels.some((x) => x.includes(l))), JSON.stringify(labels))
  check('member nav omits admin items (Monitors/Incidents/Inventory)',
    !labels.some((x) => x.includes('Monitors') || x.includes('Incidents') || x.includes('Inventory')), JSON.stringify(labels))
  check('member does NOT see Settings entry',
    (await page.locator('a[href="/dashboard/settings/api-keys"]').count()) === 0)

  await page.goto(`${BASE}/dashboard/tickets`, { waitUntil: 'domcontentloaded' })
  await shot(page, 'member-02-tickets')
  await ctx.close()
}

await browser.close()

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) {
  console.log('FAILURES:', failed.map((r) => r.name))
  process.exit(1)
}
console.log('ALL SIDEBAR CHECKS PASSED')
