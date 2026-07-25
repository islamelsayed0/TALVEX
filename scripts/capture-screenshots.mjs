/**
 * Capture the dashboard shell in both themes and write the shots to
 * docs/design/screenshots/.
 *
 * The dashboard is behind Clerk auth, so this reuses a signed in session saved
 * once to .auth/talvex.json. That file holds session tokens and is gitignored;
 * never commit it.
 *
 * Usage:
 *   1. Run the app in another terminal:   npm run dev
 *   2. Save a session once:               npm run screenshots:login
 *      A browser window opens. Sign in until you land on /dashboard, then it
 *      saves the session and closes on its own.
 *   3. Capture:                           npm run screenshots
 *      Headless. Writes <screen>-<theme>.png for every shell route, in dark
 *      and light, then you review and commit the PNGs.
 *
 * The session belongs to whoever signs in, so the shots show that person's
 * role: sign in as an admin for the admin shell, as a member for the member
 * shell. Run login again to switch accounts.
 *
 * Env:
 *   SCREENSHOT_BASE_URL   base URL of the running app (default http://localhost:3000)
 *
 * Browser binaries: Playwright's chromium is expected to be installed already.
 * If it is not, run once: npx playwright install chromium
 */
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASE_URL = process.env.SCREENSHOT_BASE_URL || 'http://localhost:3000'
const AUTH_FILE = path.join(ROOT, '.auth', 'talvex.json')
const OUT_DIR = path.join(ROOT, 'docs', 'design', 'screenshots')

// The shell routes worth a shot. Each is captured in dark and light. Members
// are redirected off the admin routes, so a member session captures the Help
// and Tickets shots and skips the rest (the redirect lands on Help).
const ROUTES = [
  { name: 'shell-overview', path: '/dashboard' },
  { name: 'shell-monitors', path: '/dashboard/monitors' },
  { name: 'shell-incidents', path: '/dashboard/incidents' },
  { name: 'shell-tickets', path: '/dashboard/tickets' },
  { name: 'shell-help', path: '/dashboard/help' },
]

const THEMES = ['dark', 'light']

async function login() {
  await mkdir(path.dirname(AUTH_FILE), { recursive: true })
  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext()
  const page = await context.newPage()
  console.log(`Opening ${BASE_URL}/sign-in — sign in until you reach the dashboard.`)
  await page.goto(`${BASE_URL}/sign-in`)
  await page.waitForURL(/\/dashboard(\/|$|\?)/, { timeout: 5 * 60 * 1000 })
  await context.storageState({ path: AUTH_FILE })
  console.log(`Saved session to ${path.relative(ROOT, AUTH_FILE)}`)
  await browser.close()
}

async function capture() {
  if (!existsSync(AUTH_FILE)) {
    console.error(
      `No saved session at ${path.relative(ROOT, AUTH_FILE)}.\n` +
        `Run: npm run screenshots:login`,
    )
    process.exit(1)
  }
  await mkdir(OUT_DIR, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  try {
    for (const theme of THEMES) {
      const context = await browser.newContext({
        storageState: AUTH_FILE,
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
      })
      // Persist the theme the way the app does, before any page script runs, so
      // the pre paint theme script reads it and the first paint is correct.
      await context.addInitScript((t) => {
        try {
          localStorage.setItem('talvex-theme', t)
        } catch {
          // Storage can be unavailable; the explicit attribute below still wins.
        }
      }, theme)
      const page = await context.newPage()
      for (const route of ROUTES) {
        await page.goto(`${BASE_URL}${route.path}`, {
          waitUntil: 'domcontentloaded',
        })
        await page.waitForSelector('header', { timeout: 15000 }).catch(() => {})
        // Force the attribute the CSS keys off, in case the session lands
        // somewhere the init script did not run.
        await page.evaluate((t) => {
          document.documentElement.dataset.theme = t
        }, theme)
        // Let the fadeUp mount animation (~0.5s) settle before the shot.
        await page.waitForTimeout(800)
        const file = path.join(OUT_DIR, `${route.name}-${theme}.png`)
        await page.screenshot({ path: file, fullPage: true })
        console.log(`wrote ${path.relative(ROOT, file)}`)
      }
      await context.close()
    }
  } finally {
    await browser.close()
  }
}

const mode = process.argv[2]
if (mode === 'login') {
  await login()
} else {
  await capture()
}
