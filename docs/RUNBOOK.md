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

### What this is not

**Self monitoring cannot detect a dead sweep.** The three monitors above are
checked by the same sweep whose health is in question, so when it stops, they
stop being checked and the Talvex status page freezes showing whatever it last
saw, which is usually all green. It will look reassuring at precisely the
moment it should not.

What it does catch, while the sweep is alive, is a dead deployment or a dead
database. That is worth having. It is not a watcher, and it does not replace
`.github/workflows/heartbeat.yml`. Do not let a BRD close out record S5 as
covering what section 1 covers.

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

## 4. Backups and restore (BRD S6)

**What cannot be done, stated plainly.** Supabase point in time recovery is a
paid add on on a paid plan, and this project's Supabase organization is on the
**free** plan. **S6's first clause, "point in time recovery enabled", is not
met and cannot be met without spending money.** That is a budget decision, not
an engineering one, and nothing below substitutes for it. Report S6 as partly
met, never as green.

Compounding it: one Supabase project backs local, preview, and production
(decision log, 2026-07-23). There is nowhere to restore *to* without disturbing
the only database, which is why the drill below restores into a local stack.

**What is met:** S6's second clause, "restore procedure documented and tested
once". The procedure is here and it has been run; see `docs/DEPLOY_LOG.md` for
the dated result.

### Taking a dump

```bash
npm run db:dump          # writes ./backups/<UTC timestamp>/{schema,data}.sql
```

`./backups/` is gitignored. **A dump contains every tenant row in the
database.** Treat the file the way you would treat the database: do not commit
it, do not put it in a shared drive, delete it when the drill is over.

**When to take one by hand**, since nothing takes one on a schedule:

- Before applying any migration that drops or rewrites a column.
- Before any repair of `supabase_migrations.schema_migrations`.
- Before the production project is split out from the shared one.

### The restore drill

The assertion is not that the commands exited zero. It is that the **isolation
suite passes against the restored data**, which exercises every RLS policy,
grant, trigger, and check constraint the schema is supposed to carry.

```bash
npm run db:start
# wipe the local public schema, then load the dump into it
docker exec -i supabase_db_TALVEX psql -U postgres -d postgres -q \
  -c "drop schema if exists public cascade; create schema public;"
docker exec -i supabase_db_TALVEX psql -U postgres -d postgres -q < backups/<ts>/schema.sql
docker exec -i supabase_db_TALVEX psql -U postgres -d postgres -q < backups/<ts>/data.sql
npx vitest run tests/isolation      # this passing is the proof
npm run db:reset                    # put the local stack back to migration state
```

**Expect seven errors on the data step**, all of the form
`relation "storage.<table>" does not exist`. The local stack does not run the
Storage service and Talvex stores no files, so those tables are empty and their
absence is harmless. Any error naming a `public.` table is real and must be
investigated.

### What this does not cover

- **No schedule.** RPO is "whenever the operator last ran `npm run db:dump`".
- **No off site copy.** The dump lives wherever it was written.
- **No automated verification.** The drill is manual.

Automated dumps into GitHub Actions artifacts were considered and **rejected**:
it would put a second complete copy of the tenant database somewhere with
weaker access controls and 90 day retention, which is a downgrade dressed as
progress. When there is customer data worth protecting there will also be a
budget, and the right answer then is the paid feature. Recorded so it is not
proposed again as a free win.

**This must change before the first real customer**, together with moving
production to its own Supabase project. Those two decisions move as a pair.

---

## 5. The pre commit secret scan

`npm ci` runs `git config core.hooksPath .githooks`, so `.githooks/pre-commit`
installs itself and scans staged changes with
`gitleaks protect --staged --redact`.

**It fails closed when gitleaks is missing**, which means a fresh machine
cannot commit until `brew install gitleaks` has run. That is deliberate: a hook
that passes when the scanner is absent produces confidence without cover, the
same reasoning that removed the escape hatch from the migration drift guard.
To commit without scanning, do it explicitly with `git commit --no-verify`.

The hook is a convenience that catches the mistake before it enters history.
**The CI gitleaks job is the boundary**, because a local hook is bypassable and
absent on any machine that has not installed dependencies. S2 asked for pre
commit scanning and this delivers it; it does not upgrade the hook into a
security control.

---

## 6. Environment variables

Every variable is documented in `.env.example`, which
`tests/env-hygiene.test.ts` keeps honest. Two traps worth repeating because
both have cost real debugging time:

- **`NEXT_PUBLIC_*` values are inlined at build time.** Changing one in the
  Vercel dashboard does nothing until a new build runs.
- **A plain redeploy can reuse the original deployment's environment
  snapshot.** After setting or changing any variable, push a commit.

Preview deployments are **partly** configured: seven variables target Preview,
but the four `NEXT_PUBLIC_*` values, `CLERK_SECRET_KEY`, and
`SUPABASE_SERVICE_ROLE_KEY` do not. Those are exactly auth and database, so a
preview build still has neither and the practical conclusion is unchanged.
Finishing it is a dashboard task, tracked in `docs/DEPLOY_LOG.md`.
