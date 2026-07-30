import assert from 'node:assert/strict'

/**
 * End to end checks for the two operations endpoints and the Talvex status
 * page, written against the same hand run convention as the other specs in
 * this directory (there is no @playwright/test runner yet; CI's end to end job
 * is planned, see .github/workflows).
 *
 * Unlike its neighbours this one needs no browser: both endpoints are JSON and
 * the status page assertion is a fetch. Run it against a running deployment:
 *
 *   BASE_URL=https://talvex-chi.vercel.app node tests/e2e/health.spec.mjs
 *
 * or against a local build pointed at the local Supabase stack:
 *
 *   npm run db:start && npm run db:reset
 *   BASE_URL=http://localhost:3200 node tests/e2e/health.spec.mjs
 *
 * The payload shapes and the failure branches are proven without a network by
 * tests/health-route.test.ts and tests/ops-heartbeat.test.ts. What this adds is
 * that the routes are actually reachable on a real deployment, which is the one
 * thing a unit test cannot say.
 *
 * TALVEX_SLUG is the self monitoring status page from docs/RUNBOOK.md. Set
 * SKIP_STATUS=1 while that org has not been created yet.
 */

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3200'
const TALVEX_SLUG = process.env.TALVEX_SLUG ?? 'talvex'

// 1. Health: the runtime can reach Postgres.
const health = await fetch(`${BASE_URL}/api/health`)
assert.equal(health.status, 200, '/api/health should be 200 on a healthy deployment')
assert.equal(health.headers.get('cache-control'), 'no-store', 'health must not be cached')
const healthBody = await health.json()
assert.deepEqual(healthBody, { ok: true }, 'health body is exactly { ok: true }')

// 2. Freshness: the sweep is alive, and the payload discloses only three keys.
const heartbeat = await fetch(`${BASE_URL}/api/ops/heartbeat`)
assert.ok(
  heartbeat.status === 200 || heartbeat.status === 503,
  'heartbeat answers 200 when fresh or 503 when stale, never anything else',
)
const beat = await heartbeat.json()
assert.deepEqual(
  Object.keys(beat).sort(),
  ['ageSeconds', 'stale', 'thresholdSeconds'],
  'heartbeat discloses exactly three keys',
)
assert.equal(
  heartbeat.status === 503,
  beat.stale === true,
  'the status code and the stale flag must agree, since the watcher trusts the code',
)
if (beat.stale) {
  console.warn(
    `WARNING: the sweep is stale (age ${beat.ageSeconds}s, threshold ${beat.thresholdSeconds}s). ` +
      'Confirm the scheduler is enabled and CRON_SECRET matches the deployment.',
  )
}

// 3. The Talvex status page, once the self monitoring org exists.
if (process.env.SKIP_STATUS !== '1') {
  const status = await fetch(`${BASE_URL}/status/${TALVEX_SLUG}`)
  assert.equal(status.status, 200, `the Talvex status page at /status/${TALVEX_SLUG} should render`)
  const html = await status.text()
  for (const path of ['/api/health', '/api/ops/heartbeat']) {
    assert.ok(
      html.includes(path) === false,
      'the status page must never leak a monitor url, including our own',
    )
  }
}

console.log('health.spec.mjs: all assertions passed')
