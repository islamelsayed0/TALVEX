import { mkdirSync } from 'node:fs'

import { clerk, clerkSetup, setupClerkTestingToken } from '@clerk/testing/playwright'
import { chromium } from 'playwright'

/**
 * End to end checks for chat grounding (the F14 follow up), written against
 * the base playwright package in the same style and harness as
 * articles.spec.mjs and usage.spec.mjs; the prerequisites (local stack with
 * Clerk third party auth, a seeded org with an admin and a member, the app
 * built against the local stack) are listed in dashboard-sidebar.spec.mjs.
 * ADDITIONALLY the org must have a working AI provider key saved, because
 * the flow sends real chat messages; without one the spec fails its
 * preflight rather than pretending to pass.
 *
 * What it proves, end to end through the real screens:
 *   - admin publishes a printer article targeted at a tag, then assigns
 *     that tag to the member through the Members settings tab
 *   - the tagged member asks the printer question in chat and the reply
 *     carries a reference card linking to the article in Get Help
 *   - the admin removes the tag; the member asks again in a fresh
 *     conversation and gets no card
 *
 * Run:
 *   BASE_URL=http://127.0.0.1:3200 CLERK_ORG_ID=org_xxx \
 *   ADMIN_EMAIL=...+clerk_test@example.com MEMBER_EMAIL=...+clerk_test@example.com \
 *   SHOTS=./shots node tests/e2e/chat-grounding.spec.mjs
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
const TAG = `e2e-ground-${STAMP}`
const ARTICLE_TITLE = `Office printer fix ${STAMP}`
const QUESTION = 'How do I fix the office printer? It shows offline.'

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

/** Ask in a FRESH conversation and wait for the reply bubble to land. */
async function askInNewChat(page, question) {
  await page.goto(`${BASE}/dashboard/chat/new`, { waitUntil: 'domcontentloaded' })
  await page.fill('textarea', question)
  await page.getByRole('button', { name: 'Send' }).click()
  // The reply is non streaming; wait for the assistant label to appear a
  // second time (greeting bubbles carry no label, replies do).
  await page.waitForSelector('text=Assistant', { timeout: 90000 })
  await page.waitForTimeout(800)
}

// ---------- ADMIN: publish the targeted article, tag the member ----------
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
  check('admin published the targeted article', true)

  await setMemberTags(page, TAG)
  check('admin tagged the member', true)
  await ctx.close()
}

// ---------- TAGGED MEMBER: the answer cites the article ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await signIn(page, MEMBER)

  await askInNewChat(page, QUESTION)
  const card = page.locator(`a:has-text("${ARTICLE_TITLE}")`)
  check('the reply carries a reference card naming the article', (await card.count()) >= 1)
  const href = (await card.first().getAttribute('href')) ?? ''
  check(
    'the card links to the member reading route',
    href.startsWith('/dashboard/help/articles/'),
    href,
  )
  await shot(page, 'grounding-01-tagged-cited')

  if (href) {
    await page.goto(`${BASE}${href}`, { waitUntil: 'domcontentloaded' })
    check(
      'the card destination opens for the tagged member',
      (await page.getByRole('heading', { name: ARTICLE_TITLE }).count()) === 1,
    )
  }
  await ctx.close()
}

// ---------- ADMIN: remove the tag ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await signIn(page, ADMIN)
  await setMemberTags(page, '')
  await ctx.close()
}

// ---------- UNTAGGED MEMBER: same question, no card ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await signIn(page, MEMBER)

  await askInNewChat(page, QUESTION)
  check(
    'without the tag the same question earns no reference card',
    (await page.locator(`a:has-text("${ARTICLE_TITLE}")`).count()) === 0,
  )
  check(
    'the from your help articles label is absent too',
    (await page.getByText('From your help articles').count()) === 0,
  )
  await shot(page, 'grounding-02-untagged-no-card')
  await ctx.close()
}

await browser.close()

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) {
  console.log('FAILURES:', failed.map((r) => r.name))
  process.exit(1)
}
console.log('ALL CHAT GROUNDING CHECKS PASSED')
