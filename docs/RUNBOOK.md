# Talvex operations runbook

The things a human owns. Everything else in this repository runs itself; what
is written here either cannot be automated or should not be.

Related documents: `docs/DECISIONS.md` is the ruling log and supersedes the
BRD where they disagree. `docs/DEPLOY_LOG.md` is the dated record of what was
actually deployed and what broke.

---

## 1. The monitoring sweep and its scheduler

**The contract.** An external scheduler (cron-job.org) sends a POST to
`/api/cron/check-monitors` every five minutes with
`Authorization: Bearer <CRON_SECRET>`. There is no Vercel cron entry; the
`crons` block was removed from `vercel.json` when the external scheduler
became the contract (decision log, 2026-07-27). GET works too and runs the same
sweep, for manual invocation.

**Why this has its own section.** This has failed in production. The scheduler
auto disabled its own job after a 405, at a time when the value it was sending
no longer matched the deployment's `CRON_SECRET`, and monitoring simply stopped.
Nothing noticed, because at the time nothing watched it.

**What watches it now, and what each thing can and cannot see:**

| Layer | Catches | Does not catch |
|---|---|---|
| Dashboard banner (admin, every page) | A stale sweep, whenever an admin looks | Anything while nobody is looking |
| `.github/workflows/heartbeat.yml`, every 30 min | A stale sweep, a dead deployment, a dead database | Nothing, within its ~45 minute resolution |
| Talvex monitoring itself (below) | A dead deployment or database, while the sweep is alive | **A dead sweep.** Its own monitors are checked by that same sweep |

Read that last row twice before trusting self monitoring as a safety net. It is
a credibility and demo feature. The GitHub workflow is the actual watcher.

**When the workflow goes red**, in order:

1. Open `https://talvex-chi.vercel.app/api/ops/heartbeat` yourself. A 503 with
   a large `ageSeconds` confirms the sweep, not the workflow, is the problem.
2. Check `https://talvex-chi.vercel.app/api/health`. A 503 there means the
   deployment or the database is the problem, not the scheduler.
3. Open the cron-job.org job. Confirm it is **enabled** (it disables itself
   after repeated failures), the method is **POST**, and the URL is exact.
4. Compare the bearer value in the scheduler against `CRON_SECRET` in the
   Vercel project. This is the pair that has drifted before.
5. If you change `CRON_SECRET` in Vercel, **trigger a fresh build from a new
   commit**. A plain redeploy can reuse the previous deployment's environment
   snapshot, which is exactly how `RESEND_API_KEY` once read as unset.
6. The sweep is self correcting once it runs. The banner clears within one
   interval and the workflow goes green on its next scheduled run; there is
   nothing to replay by hand.

**Do not** point a monitor at `/api/cron/check-monitors`. Without the bearer it
records as permanently down, and with it, every check would trigger a sweep.

---

## 2. Talvex monitors Talvex (BRD S5)

The platform monitors itself and publishes its own status page. This is both a
credibility feature and the permanent demo the BRD asks for.

**The organization is a real Clerk organization**, created the ordinary way and
synced into Postgres by the existing webhook. Do not insert a row into
`organizations` by hand: a fabricated `clerk_org_id` breaks the invariant every
RLS policy depends on, so nobody could sign in to that org, nobody could manage
its monitors, and the webhook would never reconcile it. There is deliberately
no seed script, because it could not run before a human created the Clerk org
anyway, and a service role script in the repository whose only job is inserting
tenant rows is a capability worth not having.

**Setup, about two minutes, once:**

1. Create an organization named `Talvex` in Clerk, signed in as the operator.
2. Confirm the sync landed: Clerk, Webhooks, Message Attempts should show a
   200 for `organization.created`. If `org_members` stays empty, the
   membership event is not subscribed; see `docs/DEPLOY_LOG.md`, which records
   this exact failure happening once already.
3. In Talvex, switch to that org and add three monitors at a 300 second
   interval:
   - `https://talvex-chi.vercel.app/` — the deployment serves.
   - `https://talvex-chi.vercel.app/api/health` — the runtime reaches Postgres.
   - `https://talvex-chi.vercel.app/api/ops/heartbeat` — the endpoint the
     external watcher depends on is itself serving.
4. Settings, Status page: enable it with the slug `talvex`.
5. Settings, Notifications: set the notification email, so the platform's own
   incidents go somewhere. Enabling the daily digest here is reasonable too.

**Verify:** `BASE_URL=https://talvex-chi.vercel.app node tests/e2e/health.spec.mjs`

**Note the circularity, and accept it deliberately:** the sweep is now checking
Talvex from Talvex, so a total outage takes both the checker and the checked
with it. That is inherent to self monitoring anywhere, and it is the reason the
external watcher in section 1 is not optional.

---

## 3. The operator error channel

`OPS_DISCORD_WEBHOOK` receives Talvex's own platform failures. It is not, and
must never be, any customer's webhook from notification settings.

**Setup:** create a channel in your own Discord server, create a channel
webhook, and set the full URL as `OPS_DISCORD_WEBHOOK` in the Vercel project.
Then trigger a fresh build (same environment snapshot trap as above).

When unset, platform errors are logged once and not posted, which is the
intended behaviour locally.

**What it will and will not tell you:** it rides the same deployment that
produced the error, so it reports a failing step inside a running sweep. It
reports nothing at all if the deployment is down. That case is section 1's
workflow.

---

## 4. Environment variables

Every variable is documented in `.env.example`, which
`tests/env-hygiene.test.ts` keeps honest. Two traps worth repeating because
both have cost real debugging time:

- **`NEXT_PUBLIC_*` values are inlined at build time.** Changing one in the
  Vercel dashboard does nothing until a new build runs.
- **A plain redeploy can reuse the original deployment's environment
  snapshot.** After setting or changing any variable, push a commit.

Preview deployments currently have **no** environment variables set, so preview
builds have no working auth or database. That is a dashboard task and is
tracked in `docs/DEPLOY_LOG.md`.
