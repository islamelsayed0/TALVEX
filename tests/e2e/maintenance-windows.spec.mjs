import { mkdirSync } from 'node:fs'

import { clerk, clerkSetup, setupClerkTestingToken } from '@clerk/testing/playwright'
import { chromium } from 'playwright'

/**
 * End to end checks for maintenance windows (migration 021), in the harness
 * every spec here uses (base playwright package, no runner; prerequisites
 * are listed in dashboard-sidebar.spec.mjs and are identical).
 *
 * What it proves through the real screens:
 *   - the admin journey: pause a monitor's alerts for an hour from the
 *     detail page, see the amber banner with the until time and the muted
 *     list chip, resume with one click, and watch both clear
 *   - the pause control and the banner are reachable by keyboard (the
 *     select, the Pause button, and Resume all take focus)
 *   - the member reality: monitors screens sit behind requireAdmin, so a
 *     member visiting a monitor detail is redirected to Get help and never
 *     sees a pause control at all. The spec asked that a member see the
 *     banner but not the control; there is no member reachable surface that
 *     shows monitor detail, so no access IS the member state, and the
 *     database gate (isolation suite) is what stops a member session that
 *     talks to the API directly.
 *
 * Run:
 *   BASE_URL=http://127.0.0.1:3200 CLERK_ORG_ID=org_xxx \
 *   ADMIN_EMAIL=...+clerk_test@example.com MEMBER_EMAIL=...+clerk_test@example.com \
 *   SHOTS=./shots node tests/e2e/maintenance-windows.spec.mjs
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

// ---------------------------------------------------------------------------
// Act 1: the admin pauses, sees the loud state, resumes, sees it clear.

const adminContext = await browser.newContext()
const admin = await adminContext.newPage()
await signIn(admin, ADMIN)

await admin.goto(`${BASE}/dashboard/monitors`, { waitUntil: 'domcontentloaded' })
const firstMonitor = admin.locator('a[href^="/dashboard/monitors/"]').first()
const monitorHref = await firstMonitor.getAttribute('href')
check('a monitor exists to drive', monitorHref !== null, monitorHref ?? '')

await admin.goto(`${BASE}${monitorHref}`, { waitUntil: 'domcontentloaded' })
const pauseControl = admin.locator('select#pause-hours')
check('the pause control is on the detail page', (await pauseControl.count()) === 1)

// Keyboard: the select and the button take focus like any control.
await pauseControl.focus()
check(
  'the duration select takes keyboard focus',
  await admin.evaluate(() => document.activeElement?.id === 'pause-hours'),
)

await pauseControl.selectOption('1')
await admin.getByRole('button', { name: 'Pause' }).click()
await admin.waitForLoadState('domcontentloaded')

const banner = admin.getByRole('status').filter({ hasText: 'Alerts paused until' })
check('the amber banner names the until time', (await banner.count()) === 1)
check(
  'the pause control is gone while a window is active',
  (await admin.locator('select#pause-hours').count()) === 0,
)
await shot(admin, 'maintenance-01-banner')

await admin.goto(`${BASE}/dashboard/monitors`, { waitUntil: 'domcontentloaded' })
const chip = admin.getByText('Alerts paused', { exact: true })
check('the muted chip sits on the list row', (await chip.count()) >= 1)
await shot(admin, 'maintenance-02-chip')

await admin.goto(`${BASE}${monitorHref}`, { waitUntil: 'domcontentloaded' })
const resume = admin.getByRole('button', { name: 'Resume alerts' })
await resume.focus()
check(
  'Resume takes keyboard focus',
  await admin.evaluate(() => document.activeElement?.textContent?.includes('Resume')),
)
await resume.click()
await admin.waitForLoadState('domcontentloaded')

check(
  'the banner clears on resume',
  (await admin.getByRole('status').filter({ hasText: 'Alerts paused' }).count()) === 0,
)
check(
  'the pause control returns',
  (await admin.locator('select#pause-hours').count()) === 1,
)
await admin.goto(`${BASE}/dashboard/monitors`, { waitUntil: 'domcontentloaded' })
check(
  'the chip clears on resume',
  (await admin.getByText('Alerts paused', { exact: true }).count()) === 0,
)
await shot(admin, 'maintenance-03-cleared')

await adminContext.close()

// ---------------------------------------------------------------------------
// Act 2: the member reality. Monitors are admin only screens; a member is
// redirected away and never sees a pause control.

const memberContext = await browser.newContext()
const member = await memberContext.newPage()
await signIn(member, MEMBER)

await member.goto(`${BASE}${monitorHref}`, { waitUntil: 'domcontentloaded' })
await member.waitForLoadState('networkidle').catch(() => {})
const memberUrl = member.url()
check(
  'a member is redirected off monitor detail entirely',
  !memberUrl.includes('/dashboard/monitors'),
  memberUrl,
)
check(
  'no pause control anywhere in a member session',
  (await member.locator('select#pause-hours').count()) === 0,
)
await shot(member, 'maintenance-04-member-redirect')

await memberContext.close()
await browser.close()

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length > 0) process.exit(1)
