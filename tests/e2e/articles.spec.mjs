import { mkdirSync } from 'node:fs'

import { clerk, clerkSetup, setupClerkTestingToken } from '@clerk/testing/playwright'
import { chromium } from 'playwright'

/**
 * End to end checks for the knowledge base (F14), written against the base
 * playwright package in the same style and against the same harness as
 * usage.spec.mjs; the prerequisites (local stack with Clerk third party
 * auth, a seeded org with an admin and a member, the app built against the
 * local stack) are identical and are listed in dashboard-sidebar.spec.mjs.
 *
 * What it proves, end to end through the real screens:
 *   - the admin creates a targeted article, publishes it, and assigns the
 *     matching tag to the member through the Members settings tab
 *   - that member reads the article through Get Help
 *   - the admin removes the tag; the article is gone for the member, list
 *     and direct URL both, with no trace it exists
 *   - a draft is invisible to the member throughout
 *   - the member reaches neither article management nor the Members tab
 *   - member facing copy never says the word tags
 *
 * Run:
 *   BASE_URL=http://127.0.0.1:3200 CLERK_ORG_ID=org_xxx \
 *   ADMIN_EMAIL=...+clerk_test@example.com MEMBER_EMAIL=...+clerk_test@example.com \
 *   SHOTS=./shots node tests/e2e/articles.spec.mjs
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
const TAG = `e2e-tag-${STAMP}`
const PUBLISHED_TITLE = `Printer guide ${STAMP}`
const DRAFT_TITLE = `Unfinished draft ${STAMP}`

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

/** Create an article via the real form; optionally publish from the edit
 * screen it lands back from (via the list). */
async function createArticle(page, { title, audience, publish }) {
  await page.goto(`${BASE}/dashboard/articles/new`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[name="title"]', title)
  await page.fill('input[name="audience"]', audience)
  await page.fill(
    'textarea[name="body"]',
    '## Steps\n\n1. Turn it off\n2. Turn it on again',
  )
  await page.click('button[type="submit"]')
  await page.waitForURL('**/dashboard/articles', { timeout: 15000 })
  if (publish) {
    await page.getByRole('link', { name: title }).click()
    await page.waitForURL('**/edit**')
    await page.getByRole('button', { name: 'Publish' }).click()
    await page.waitForURL('**/dashboard/articles', { timeout: 15000 })
  }
}

/** Set the member fixture's tags through the Members settings tab. The
 * member's row is found by its form input; the fixture org has exactly one
 * non admin member. */
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

// ---------- ADMIN: create content and target the member ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await signIn(page, ADMIN)

  await createArticle(page, { title: PUBLISHED_TITLE, audience: TAG, publish: true })
  await createArticle(page, { title: DRAFT_TITLE, audience: '', publish: false })

  await page.goto(`${BASE}/dashboard/articles`, { waitUntil: 'domcontentloaded' })
  check(
    'admin list shows both articles with audience and status',
    (await page.getByRole('link', { name: PUBLISHED_TITLE }).count()) === 1 &&
      (await page.getByRole('link', { name: DRAFT_TITLE }).count()) === 1 &&
      (await page.getByText(TAG).count()) >= 1,
  )
  await shot(page, 'articles-01-admin-list')

  await setMemberTags(page, TAG)
  check('admin assigned the tag through the Members tab', true)
  await shot(page, 'articles-02-members-tab')

  await ctx.close()
}

// ---------- MEMBER: reads what the tag admits ----------
let articleUrl = ''
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await signIn(page, MEMBER)

  await page.goto(`${BASE}/dashboard/help`, { waitUntil: 'domcontentloaded' })
  check(
    'member sees the Browse help articles door',
    (await page.locator('a[href="/dashboard/help/articles"]').count()) === 1,
  )

  await page.goto(`${BASE}/dashboard/help/articles`, { waitUntil: 'domcontentloaded' })
  check(
    'member sees the targeted article',
    (await page.getByRole('link', { name: PUBLISHED_TITLE }).count()) === 1,
  )
  check(
    'the draft is invisible to the member',
    (await page.getByText(DRAFT_TITLE).count()) === 0,
  )
  const pageText = await page.locator('main').innerText()
  check('member copy never says tags', !/\btags?\b/i.test(pageText), pageText.slice(0, 120))

  await page.getByRole('link', { name: PUBLISHED_TITLE }).click()
  await page.waitForURL('**/dashboard/help/articles/**')
  articleUrl = page.url()
  check(
    'the article renders its markdown as elements',
    (await page.getByRole('heading', { name: 'Steps' }).count()) === 1,
  )
  await shot(page, 'articles-03-member-reading')

  check(
    'member cannot reach article management',
    await page
      .goto(`${BASE}/dashboard/articles`, { waitUntil: 'domcontentloaded' })
      .then(() => page.waitForTimeout(600))
      .then(() => page.url().includes('/dashboard/help')),
    page.url(),
  )
  check(
    'member cannot reach the Members tab',
    await page
      .goto(`${BASE}/dashboard/settings/members`, { waitUntil: 'domcontentloaded' })
      .then(() => page.waitForTimeout(600))
      .then(() => page.url().includes('/dashboard/help')),
    page.url(),
  )

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

// ---------- MEMBER: the article is gone without a trace ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await signIn(page, MEMBER)

  await page.goto(`${BASE}/dashboard/help/articles`, { waitUntil: 'domcontentloaded' })
  check(
    'after tag removal the article is gone from the list',
    (await page.getByText(PUBLISHED_TITLE).count()) === 0,
  )
  await shot(page, 'articles-04-member-after-removal')

  await page.goto(articleUrl, { waitUntil: 'domcontentloaded' })
  const gone =
    (await page.getByText(PUBLISHED_TITLE).count()) === 0 &&
    (await page.getByText('404').count()) +
      (await page.getByText(/not.*found/i).count()) >
      0
  check('the direct URL 404s like it never existed', gone, page.url())

  check(
    'the draft stayed invisible throughout',
    (await page.getByText(DRAFT_TITLE).count()) === 0,
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
console.log('ALL ARTICLE CHECKS PASSED')
