import { mkdirSync } from 'node:fs'

import { clerk, clerkSetup, setupClerkTestingToken } from '@clerk/testing/playwright'
import { chromium } from 'playwright'

/**
 * End to end checks for the ticket lifecycle (migration 019), written against
 * the base playwright package in the same style and harness as
 * articles.spec.mjs; the prerequisites (local stack with Clerk third party
 * auth, a seeded org with an admin and a member, the app built against the
 * local stack) are identical and are listed in dashboard-sidebar.spec.mjs.
 *
 * What it proves, end to end through the real screens:
 *   - the member journey: raise a request, resolve it themselves, reopen it
 *     with the required explanation, raise a second one and cancel it, remove
 *     it from their list, and find it again behind Show all
 *   - reopening with an empty explanation is refused
 *   - the admin journey: the close dialog with both boxes, resolving the
 *     ticket, with the message reaching the requester
 *   - THE ONE THAT MATTERS: the requester sees no trace of the internal note,
 *     not the text, not a placeholder, not a gap
 *
 * Run:
 *   BASE_URL=http://127.0.0.1:3200 CLERK_ORG_ID=org_xxx \
 *   ADMIN_EMAIL=...+clerk_test@example.com MEMBER_EMAIL=...+clerk_test@example.com \
 *   SHOTS=./shots node tests/e2e/ticket-lifecycle.spec.mjs
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
const KEEP = `Printer offline ${STAMP}`
const WITHDRAW = `Never mind this one ${STAMP}`
const NOTES = `Docking station ${STAMP}`
const NOTE_TEXT = `INTERNAL ONLY ${STAMP}: third failure, replace the dock`
const MESSAGE_TEXT = `Swapped the cable ${STAMP}, try it now`

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

/** Raise a request through the real Get help form and land on its detail. */
async function raise(page, title) {
  await page.goto(`${BASE}/dashboard/help/ticket`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[name="title"]', title)
  await page.fill(
    'textarea[name="description"]',
    'Raised by the ticket lifecycle end to end spec.',
  )
  await page.click('button[type="submit"]')
  await page.waitForURL('**/dashboard/tickets/**', { timeout: 15000 })
  return page.url().split('?')[0]
}

// ---------- MEMBER: the whole journey on their own requests ----------
{
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await signIn(page, MEMBER)

  const keepUrl = await raise(page, KEEP)
  check('a member can raise a request', page.url().includes('/dashboard/tickets/'))

  // Resolve it themselves.
  await page.getByRole('button', { name: 'This is resolved' }).click()
  await page.waitForURL(keepUrl, { timeout: 15000 })
  await shot(page, 'lifecycle-member-resolved')
  check(
    'the member resolved their own request',
    (await page.getByText('Resolved', { exact: false }).count()) > 0,
  )

  // Reopening with nothing typed must be refused. The textarea is `required`,
  // so the browser blocks it first; that is the intended first line and the
  // database is the second (proved in the isolation suite).
  const explanation = page.locator('textarea[name="explanation"]')
  check('a resolved request offers reopen with an explanation box', await explanation.isVisible())
  await page.getByRole('button', { name: 'Reopen this request' }).click()
  await page.waitForTimeout(500)
  check(
    'reopening with an empty explanation does not go through',
    (await page.locator('textarea[name="explanation"]').count()) > 0 &&
      page.url().startsWith(keepUrl),
  )

  // Reopen properly.
  await explanation.fill('It is doing it again this morning.')
  await page.getByRole('button', { name: 'Reopen this request' }).click()
  await page.waitForURL(keepUrl, { timeout: 15000 })
  await shot(page, 'lifecycle-member-reopened')
  check(
    'the explanation is posted as the member comment in the same action',
    (await page.getByText('It is doing it again this morning.').count()) > 0,
  )
  check(
    'the request is open again',
    (await page.getByRole('button', { name: 'This is resolved' }).count()) > 0,
  )

  // A second request, withdrawn.
  const withdrawUrl = await raise(page, WITHDRAW)
  await page.getByRole('link', { name: 'Cancel this request' }).click()
  await page.waitForURL('**/cancel', { timeout: 15000 })
  await shot(page, 'lifecycle-member-cancel-confirm')
  await page.getByRole('button', { name: 'Cancel this request' }).click()
  await page.waitForURL(withdrawUrl, { timeout: 15000 })
  check(
    'the member withdrew the second request',
    (await page.getByText('Canceled', { exact: false }).count()) > 0,
  )
  check(
    'a canceled request offers no way back for the requester',
    (await page.getByRole('button', { name: 'This is resolved' }).count()) === 0 &&
      (await page.locator('textarea[name="explanation"]').count()) === 0,
  )

  // Remove it from the list, then find it behind Show all.
  await page.getByRole('button', { name: 'Remove from my list' }).click()
  await page.waitForURL('**/dashboard/tickets', { timeout: 15000 })
  await shot(page, 'lifecycle-member-list-default')
  check(
    'the removed request is gone from the default list',
    (await page.getByText(WITHDRAW).count()) === 0,
  )
  check(
    'the request the member still cares about is still listed',
    (await page.getByText(KEEP).count()) > 0,
  )

  await page.getByRole('link', { name: 'Show all' }).click()
  await page.waitForURL('**/dashboard/tickets?show=all', { timeout: 15000 })
  await shot(page, 'lifecycle-member-list-show-all')
  check(
    'Show all reveals it again, because nothing was deleted',
    (await page.getByText(WITHDRAW).count()) > 0,
  )

  await ctx.close()
}

// ---------- ADMIN: the close dialog, both boxes ----------
let notesUrl = ''
{
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await signIn(page, MEMBER)
  notesUrl = await raise(page, NOTES)
  await ctx.close()
}

{
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await signIn(page, ADMIN)
  await page.goto(notesUrl, { waitUntil: 'domcontentloaded' })

  await page.getByText('Close ticket', { exact: true }).click()
  await page.waitForTimeout(200)
  await page.fill('textarea[name="message"]', MESSAGE_TEXT)
  await page.fill('textarea[name="note"]', NOTE_TEXT)
  await shot(page, 'lifecycle-admin-close-dialog')
  await page.getByRole('button', { name: 'Resolve ticket' }).click()
  await page.waitForURL(notesUrl, { timeout: 15000 })
  await shot(page, 'lifecycle-admin-after-close')

  check(
    'the admin sees the message they sent',
    (await page.getByText(MESSAGE_TEXT).count()) > 0,
  )
  check(
    'the admin sees their internal note',
    (await page.getByText(NOTE_TEXT).count()) > 0,
  )
  check(
    'the internal note is marked as one',
    (await page.getByText('Internal', { exact: true }).count()) > 0,
  )

  await ctx.close()
}

// ---------- MEMBER: no trace of the note, anywhere ----------
{
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await signIn(page, MEMBER)
  await page.goto(notesUrl, { waitUntil: 'domcontentloaded' })
  await shot(page, 'lifecycle-member-sees-no-note')

  const body = await page.locator('body').innerText()
  check('the requester reads the message meant for them', body.includes(MESSAGE_TEXT))
  check('the requester never sees the note text', !body.includes(NOTE_TEXT))
  check(
    'the requester never sees the note marker either',
    !/\bInternal\b/.test(body),
  )
  check(
    'no placeholder or gap betrays that something was withheld',
    !/hidden|withheld|admin only|not shown/i.test(body),
  )
  check(
    'the requester can still reopen it, so the close did not lock them out',
    (await page.locator('textarea[name="explanation"]').count()) > 0,
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
console.log('ALL TICKET LIFECYCLE CHECKS PASSED')
