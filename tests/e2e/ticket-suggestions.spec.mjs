import { mkdirSync } from 'node:fs'

import { clerk, clerkSetup, setupClerkTestingToken } from '@clerk/testing/playwright'
import { chromium } from 'playwright'

/**
 * End to end checks for document suggestions on the ticket form, in the
 * harness every spec here uses (base playwright package, no runner;
 * prerequisites listed in dashboard-sidebar.spec.mjs). The printer scenario
 * from chat-grounding.spec.mjs, pointed at the Get Help ticket form: no AI
 * provider key needed, because suggestions are retrieval only.
 *
 * What it proves through the real screens:
 *   - admin publishes a printer document targeted at a tag and assigns the
 *     tag to the member
 *   - the tagged member types the printer draft into the ticket form and
 *     the "These might answer your question" strip appears with the
 *     document, which opens in a NEW TAB while the draft survives untouched
 *   - the admin clears the tag; the same draft renders NOTHING, no empty
 *     state, no heading, no hint the feature exists
 *
 * Run:
 *   BASE_URL=http://127.0.0.1:3200 CLERK_ORG_ID=org_xxx \
 *   ADMIN_EMAIL=...+clerk_test@example.com MEMBER_EMAIL=...+clerk_test@example.com \
 *   SHOTS=./shots node tests/e2e/ticket-suggestions.spec.mjs
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

const STAMP = Date.now().toString(36)
const TAG = `e2e-suggest-${STAMP}`
const ARTICLE_TITLE = `Office printer fix ${STAMP}`
const DRAFT_TITLE = 'The office printer will not print'
const DRAFT_BODY = 'It shows offline on every computer since this morning.'

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

async function setMemberTags(page, value) {
  await page.goto(`${BASE}/dashboard/settings/members`, { waitUntil: 'domcontentloaded' })
  const forms = page.locator('form:has(input[name="clerk_user_id"])')
  const count = await forms.count()
  let target = null
  for (let i = 0; i < count; i += 1) {
    const roleText = await forms
      .nth(i)
      .locator('xpath=ancestor::div[contains(@class,"border-t")]')
      .first()
      .innerText()
      .catch(() => '')
    if (/member/i.test(roleText) && !/owner|admin/i.test(roleText)) {
      target = forms.nth(i)
      break
    }
  }
  if (!target) target = forms.last()
  await target.locator('input[name="tags"]').fill(value)
  await target.locator('button[type="submit"]').click()
  await page.waitForURL('**/dashboard/settings/members?saved=1', { timeout: 15000 })
}

/** Type the draft into the ticket form and give the debounce time to fire. */
async function typeDraft(page) {
  await page.goto(`${BASE}/dashboard/help/ticket`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[name="title"]', DRAFT_TITLE)
  await page.fill('textarea[name="description"]', DRAFT_BODY)
  await page.waitForTimeout(1500)
}

// ---------- ADMIN: publish the targeted document, tag the member ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await signIn(page, ADMIN)

  await page.goto(`${BASE}/dashboard/articles/new`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[name="title"]', ARTICLE_TITLE)
  await page.fill('input[name="audience"]', TAG)
  await page.fill(
    'textarea[name="body"]',
    '## Office printer offline\n\n1. Power cycle the printer\n2. Check the network cable\n3. Reinstall the driver',
  )
  await page.click('button[type="submit"]')
  await page.waitForURL('**/dashboard/articles', { timeout: 15000 })
  await page.getByRole('link', { name: ARTICLE_TITLE }).click()
  await page.waitForURL('**/edit**')
  await page.getByRole('button', { name: 'Publish' }).click()
  await page.waitForURL('**/dashboard/articles', { timeout: 15000 })
  check('admin published the targeted document', true)

  await setMemberTags(page, TAG)
  check('admin tagged the member', true)
  await ctx.close()
}

// ---------- MEMBER, tagged: the draft surfaces the document ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await signIn(page, MEMBER)
  await typeDraft(page)

  const heading = page.getByText('These might answer your question')
  check('the suggestions strip appeared', (await heading.count()) === 1)
  const link = page.getByRole('link', { name: ARTICLE_TITLE })
  check('the strip names the document', (await link.count()) === 1)
  check(
    'the document opens in a new tab',
    (await link.getAttribute('target')) === '_blank',
  )
  await shot(page, 'suggestions-01-tagged-strip')

  // Open it and prove the draft survives untouched in the original tab.
  const [docPage] = await Promise.all([ctx.waitForEvent('page'), link.click()])
  await docPage.waitForLoadState('domcontentloaded')
  check(
    'the document view rendered',
    (await docPage.getByText('Power cycle the printer').count()) >= 1,
  )
  await docPage.close()
  check(
    'the draft title survived',
    (await page.inputValue('input[name="title"]')) === DRAFT_TITLE,
  )
  check(
    'the draft description survived',
    (await page.inputValue('textarea[name="description"]')) === DRAFT_BODY,
  )
  await ctx.close()
}

// ---------- ADMIN: clear the tag ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await signIn(page, ADMIN)
  await setMemberTags(page, '')
  check('admin cleared the tag', true)
  await ctx.close()
}

// ---------- MEMBER, untagged: the same draft renders silence ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await signIn(page, MEMBER)
  await typeDraft(page)

  check(
    'no strip, no heading, no hint',
    (await page.getByText('These might answer your question').count()) === 0,
  )
  check(
    'no document link either',
    (await page.getByRole('link', { name: ARTICLE_TITLE }).count()) === 0,
  )
  await shot(page, 'suggestions-02-untagged-silence')
  await ctx.close()
}

await browser.close()

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length > 0) process.exit(1)
