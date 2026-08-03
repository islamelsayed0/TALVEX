import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import AxeBuilder from '@axe-core/playwright'
import { clerk, clerkSetup, setupClerkTestingToken } from '@clerk/testing/playwright'
import { chromium } from 'playwright'

/**
 * The axe gate. Run it against the real running app, in the same hand run idiom
 * as the other specs here:
 *
 *   BASE_URL=http://localhost:3000 STATUS_SLUG=northwind \
 *     node tests/e2e/accessibility.spec.mjs
 *
 * /accessibility commits Talvex to WCAG 2.2 Level AA. This is what stops that
 * from being a sentence nobody checks. Any violation axe rates serious or
 * critical fails the run.
 *
 * Rule exclusions: none. The default is zero, and anything added here needs a
 * reason written beside it, because an exclusion is a promise quietly withdrawn.
 *
 * The signed in pages use the Clerk test mode sign in the other specs here
 * already use (setupClerkTestingToken past the bot check, then a fixed code
 * email_code sign in for a +clerk_test address). To include them:
 *
 *   BASE_URL=http://localhost:3000 CLERK_ORG_ID=org_xxx \
 *     ADMIN_EMAIL=you+clerk_test@example.com \
 *     node tests/e2e/accessibility.spec.mjs
 *
 * Without those the public pages are still scanned and the dashboard is
 * reported as skipped, loudly, rather than silently passed. A scan that quietly
 * covers less than it claims is worse than one that fails.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'
const STATUS_SLUG = process.env.STATUS_SLUG ?? 'northwind'
const ORG_ID = process.env.CLERK_ORG_ID
const ADMIN_EMAIL = process.env.ADMIN_EMAIL
const AUTH_FILE =
  process.env.AUTH_FILE ?? path.join(ROOT, '.auth', `${STATUS_SLUG}.json`)

/** WCAG 2.2 AA and the two rule sets that carry the structural checks. */
const TAGS = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22aa',
  'best-practice',
]

const PUBLIC_PAGES = [
  { name: 'landing', path: '/' },
  { name: 'terms', path: '/terms' },
  { name: 'privacy', path: '/privacy' },
  { name: 'accessibility', path: '/accessibility' },
  { name: 'status page', path: `/status/${STATUS_SLUG}` },
  { name: 'sign in', path: '/sign-in' },
]

const SIGNED_IN_PAGES = [
  { name: 'dashboard shell', path: '/dashboard' },
  { name: 'get help', path: '/dashboard/help' },
  { name: 'help request form', path: '/dashboard/help/ticket' },
]

const BLOCKING = new Set(['serious', 'critical'])

function report(name, violations) {
  const blocking = violations.filter((v) => BLOCKING.has(v.impact))
  const minor = violations.length - blocking.length

  if (blocking.length === 0) {
    const tail = minor > 0 ? ` (${minor} below serious)` : ''
    console.log(`  ok   ${name}${tail}`)
    return 0
  }

  console.log(`  FAIL ${name}: ${blocking.length} serious or critical`)
  for (const v of blocking) {
    console.log(`       [${v.impact}] ${v.id}: ${v.help}`)
    for (const node of v.nodes.slice(0, 3)) {
      console.log(`         ${node.target.join(' ')}`)
    }
    if (v.nodes.length > 3) {
      console.log(`         ...and ${v.nodes.length - 3} more`)
    }
  }
  return blocking.length
}

/**
 * A signed in browser context, by whichever route is available.
 *
 * Preferred: the Clerk test mode sign in the other specs here use, which needs
 * CLERK_ORG_ID and ADMIN_EMAIL and works from a cold start.
 *
 * Fallback: a session saved by `npm run screenshots:login`, which is how a
 * developer already has one sitting on disk. Cheaper, but it expires.
 *
 * Returns null when neither is available, so the caller can say so out loud
 * instead of quietly scanning six pages and calling it full coverage.
 */
async function openSignedInContext(browser) {
  const viewport = { width: 1280, height: 900 }

  if (ORG_ID && ADMIN_EMAIL) {
    await clerkSetup({
      publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      secretKey: process.env.CLERK_SECRET_KEY,
    })
    const ctx = await browser.newContext({ viewport })
    ctx.signIn = async (page) => {
      await setupClerkTestingToken({ page })
      await page.goto(`${BASE_URL}/sign-in`, { waitUntil: 'domcontentloaded' })
      await clerk.loaded({ page })
      await clerk.signIn({
        page,
        signInParams: { strategy: 'email_code', identifier: ADMIN_EMAIL },
      })
      await page.evaluate(
        (orgId) => window.Clerk.setActive({ organization: orgId }),
        ORG_ID,
      )
      await page.waitForTimeout(600)
    }
    console.log('  (Clerk test mode sign in)')
    return ctx
  }

  if (existsSync(AUTH_FILE)) {
    console.log(`  (saved session ${path.relative(ROOT, AUTH_FILE)})`)
    return browser.newContext({ storageState: AUTH_FILE, viewport })
  }

  return null
}

async function scan(page, url) {
  await page.goto(url, { waitUntil: 'networkidle' })
  // Clerk mounts its widget after hydration; scanning before it lands would
  // pass by scanning an empty box.
  if (url.includes('/sign-in')) {
    await page.waitForSelector('.cl-rootBox', { timeout: 20000 })
  }
  return new AxeBuilder({ page }).withTags(TAGS).analyze()
}

const browser = await chromium.launch({ headless: true })
let failures = 0
const skipped = []

try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  })
  const page = await context.newPage()

  console.log('public pages')
  for (const p of PUBLIC_PAGES) {
    const results = await scan(page, `${BASE_URL}${p.path}`)
    failures += report(p.name, results.violations)
  }

  console.log('signed in pages')
  const authed = await openSignedInContext(browser)
  if (!authed) {
    for (const p of SIGNED_IN_PAGES) skipped.push(p.name)
    console.log('  SKIPPED: no session. Set CLERK_ORG_ID and ADMIN_EMAIL, or')
    console.log(`  save one at ${AUTH_FILE} with npm run screenshots:login`)
  } else {
    const authedPage = await authed.newPage()
    if (authed.signIn) await authed.signIn(authedPage)
    for (const p of SIGNED_IN_PAGES) {
      const results = await scan(authedPage, `${BASE_URL}${p.path}`)
      failures += report(p.name, results.violations)
    }
    await authed.close()
  }

  // The keyboard promises, checked rather than assumed.
  console.log('keyboard')
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' })
  await page.keyboard.press('Tab')
  const firstFocus = await page.evaluate(() => {
    const el = document.activeElement
    return {
      text: el?.textContent?.trim() ?? '',
      href: el?.getAttribute('href') ?? '',
      visible: el ? el.getBoundingClientRect().width > 0 : false,
    }
  })
  if (
    firstFocus.href !== '#main-content' ||
    !firstFocus.text.includes('Skip to main content')
  ) {
    console.log(
      `  FAIL skip link is not the first focusable element (got "${firstFocus.text}")`,
    )
    failures += 1
  } else if (!firstFocus.visible) {
    console.log('  FAIL skip link is focused but not visible')
    failures += 1
  } else {
    console.log('  ok   skip link is first and becomes visible on focus')
  }

  const ringed = await page.evaluate(() => {
    const el = document.activeElement
    if (!el) return null
    const s = getComputedStyle(el)
    return { width: s.outlineWidth, style: s.outlineStyle }
  })
  if (!ringed || parseFloat(ringed.width) < 2 || ringed.style === 'none') {
    console.log(`  FAIL focus ring is under 2px or absent (${JSON.stringify(ringed)})`)
    failures += 1
  } else {
    console.log(`  ok   focus ring is ${ringed.width} ${ringed.style}`)
  }

  // The help request flow, by keyboard only. The governing product test is
  // that a non technical office worker can ask for help in one screen with one
  // obvious action, and that has to hold for somebody who never touches a
  // mouse.
  //
  // Reach and operate, not submit: sending would put a real ticket into the
  // org this runs against. What is proved here is that every field and the
  // submit button are reachable by Tab, that typing lands in them, and that
  // focus is visible the whole way. Submission itself is covered by
  // ticket-lifecycle.spec.mjs.
  if (authed) {
    console.log('help request flow, keyboard only')
    const kb = await browser.newContext({
      storageState: AUTH_FILE,
      viewport: { width: 1280, height: 900 },
    })
    const kbPage = await kb.newPage()
    await kbPage.goto(`${BASE_URL}/dashboard/help/ticket`, {
      waitUntil: 'networkidle',
    })

    const reached = []
    const unringed = []
    for (let i = 0; i < 40; i++) {
      await kbPage.keyboard.press('Tab')
      const el = await kbPage.evaluate(() => {
        const a = document.activeElement
        if (!a) return null
        const s = getComputedStyle(a)
        return {
          tag: a.tagName.toLowerCase(),
          name: a.getAttribute('name') ?? '',
          type: a.getAttribute('type') ?? '',
          text: (a.textContent ?? '').trim().slice(0, 30),
          outline: `${s.outlineWidth} ${s.outlineStyle}`,
        }
      })
      if (!el) break
      if (['input', 'textarea', 'select', 'button'].includes(el.tag)) {
        const label = el.name || el.type || el.text || el.tag
        reached.push(label)
        if (parseFloat(el.outline) < 2 || el.outline.includes('none')) {
          unringed.push(`${el.tag}[${label}] outline:${el.outline}`)
        }
      }
      if (el.tag === 'button' && el.type === 'submit') break
    }

    const hitSubmit = reached.some((r) => r === 'submit' || /send|create|submit/i.test(r))
    if (!hitSubmit) {
      console.log(`  FAIL never reached the submit button (saw: ${reached.join(', ')})`)
      failures += 1
    } else {
      console.log(`  ok   tabbed to submit through ${reached.length} controls`)
    }
    if (unringed.length > 0) {
      console.log('  FAIL controls with no visible focus ring:')
      for (const u of unringed) console.log(`       ${u}`)
      failures += 1
    } else {
      console.log('  ok   every control on the flow showed the focus ring')
    }

    // Typing lands where focus is, so the form is operable and not just
    // traversable.
    await kbPage.goto(`${BASE_URL}/dashboard/help/ticket`, { waitUntil: 'networkidle' })
    for (let i = 0; i < 40; i++) {
      await kbPage.keyboard.press('Tab')
      const isField = await kbPage.evaluate(() => {
        const t = document.activeElement?.tagName.toLowerCase()
        return t === 'input' || t === 'textarea'
      })
      if (isField) break
    }
    await kbPage.keyboard.type('Keyboard only smoke test')
    const typed = await kbPage.evaluate(() => {
      const a = document.activeElement
      return a && 'value' in a ? String(a.value) : ''
    })
    if (typed.includes('Keyboard only smoke test')) {
      console.log('  ok   typed input lands in the focused field')
    } else {
      console.log(`  FAIL typing did not reach a field (got "${typed}")`)
      failures += 1
    }
    await kb.close()
  }

  console.log('')
  if (skipped.length > 0) {
    console.log(`skipped, not passed: ${skipped.join(', ')}`)
  }
  if (failures > 0) {
    console.log(`accessibility.spec.mjs: ${failures} blocking failures`)
    process.exitCode = 1
  } else {
    console.log('accessibility.spec.mjs: all checks passed')
  }
} finally {
  await browser.close()
}
