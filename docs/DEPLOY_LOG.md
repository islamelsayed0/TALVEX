# Talvex — Deploy Log (Task 6)

Incident style log of the Phase 0 production deploy. Every action in order:
what ran, why, what happened, what failed and how it was recovered. Written so
the deploy can be reconstructed after the fact. Timestamps are local (EDT).

Operator: Claude Code, under explicit grant from Islam Elsayed on 2026-07-22.
Scope granted: merge PR #5, complete Vercel environment variables, create the
production Clerk webhook, deploy, and verify what is verifiable without a
human. Anything destructive or irreversible outside that scope stops and asks.

---

## 10:20 — Pre flight: state of the world

Checked before touching anything.

- `git log --oneline -3` → local branch `task-5-isolation-proof` at `9f3a961`,
  main still at `739f5f0` (Task 4).
- `gh pr view 5` → **OPEN / CLEAN**. Not merged, contrary to the working
  assumption. Recorded and surfaced rather than acted on.
- `npm run build` → **exit 0**. Compiled in 1.57s, TypeScript clean, 7 routes
  emitted (`/`, `/_not-found`, `/api/webhooks/clerk`, `/dashboard`,
  `/select-org`, `/sign-in/[[...sign-in]]`, `/sign-up/[[...sign-up]]`) plus
  middleware. The app is deployable. CI does not yet run a build job, so this
  was the first production build verification of the project.
- Environment variable audit of `.env.local`, names and populated state only,
  values never printed: all 8 required variables **SET**, including the two
  Task 4 additions (`SUPABASE_SERVICE_ROLE_KEY`,
  `CLERK_WEBHOOK_SIGNING_SECRET`) that Task 0 had listed as outstanding.
- Clerk key prefix inspected (first 8 characters only): `pk_test_`.

## 10:22 — Blocker 1: Clerk instance type versus Task 6's free subdomain

`pk_test_` means a Clerk **development** instance. Task 6 asks for a production
deploy on a free `talvex.vercel.app` style subdomain. These conflict: a Clerk
production instance requires DNS records (`clerk.<domain>`, `accounts.<domain>`
and email records) on a domain you control, and DNS records cannot be added to
a `*.vercel.app` subdomain because Vercel owns that zone.

Escalated to the operator rather than guessed. **Decision: ship on
`vercel.app` with development keys.** Consequences accepted: a Clerk
development banner, a Google consent screen showing an `accounts.dev` domain,
and a development instance user cap. The domain purchase stays deferred exactly
as BRD section 9.1 budgets it.

## 10:24 — Blocker 2: permission classifier denials

`gh pr merge` and `npx vercel` were both denied by the auto mode permission
classifier. No workaround was attempted. Escalated to the operator.

**Resolution 10:34** — operator granted `Bash(gh pr *)`, `Bash(gh run *)` and
`Bash(npx vercel *)` in `.claude/settings.local.json` (gitignored, so the grant
does not reach the repository). Per operator condition 3, destructive Vercel
operations are still self limited: no env var deletion, no domain changes, no
touching other projects, without asking first.

## 10:35 — PR #5 merged

`gh pr merge 5 --squash --delete-branch` → merged at 14:35:18Z as **`e1f63e1`**,
"Task 5: the isolation proof (#5)". Remote branch deleted, local checkout
switched to `main`. Verified: `gh pr view 5` reports MERGED,
`git log` shows `e1f63e1` on top of `739f5f0`.

`git switch -c task-6-deploy` → Task 6 work branches from the new main. Nothing
is committed to main directly (CLAUDE.md rule 9).

## 10:36 — Vercel authentication and environment audit

`npx vercel whoami` → `islamelsayed0`. Project link read from
`.vercel/project.json`: `talvex`, org `islamelsayed0s-projects`.

`npx vercel env ls` across all environments. Values were never printed; only
names and target environments. Findings:

| Variable | Production | Preview | Development |
|---|---|---|---|
| NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY | set | **missing** | set |
| CLERK_SECRET_KEY | set | **missing** | set |
| NEXT_PUBLIC_CLERK_SIGN_IN_URL | set | **missing** | set |
| NEXT_PUBLIC_CLERK_SIGN_UP_URL | set | **missing** | set |
| NEXT_PUBLIC_SUPABASE_URL | set | **missing** | set |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | set | **missing** | set |
| SUPABASE_SERVICE_ROLE_KEY | set | **missing** | set |
| CLERK_WEBHOOK_SIGNING_SECRET | **missing** | **missing** | **missing** |

Two corrections to the record. Task 0 states the env vars were "set across
production, preview, and development" — **Preview has none of them**.
And `CLERK_WEBHOOK_SIGNING_SECRET`, added to `.env.local` during Task 4, was
never propagated to Vercel in any environment.

## 10:37 — Failure: `vercel env add` cannot target all Preview branches

Attempt 1, value piped on stdin → `action_required / git_branch_required`.
Attempt 2, using the CLI's own suggested form
`vercel env add <name> preview --value <value> --yes` → same error.
Attempt 3, adding `--force` as the error's `next[]` block instructed → the CLI
returned **the identical command** as the suggested fix. A loop.

Diagnosis: Vercel CLI 50.37.1 detects an agent, forces `--non-interactive`, and
the "all Preview branches" path still demands an interactive branch answer that
no documented flag satisfies. Not recoverable from the CLI.

**Recovery: none attempted; scope respected.** No values were leaked in the
process (secrets were passed through a shell variable, never a literal). Preview
variables are left for the dashboard, steps in the handoff section below. This
does not block the production deploy, which is Task 6's actual deliverable.

## 10:39 — Production deploy: already done, by git integration

`npx vercel ls --prod` showed a production deployment created **10:35:21**,
three seconds after the PR #5 merge commit. The Vercel git integration deployed
`main` automatically; no manual `vercel deploy --prod` was needed or run.

- Deployment: `dpl_FZSirSTqJWHDBWjprLdDgzxYED5N`, status **Ready**, 34s build.
- `npx vercel inspect` confirms it carries the production aliases and that the
  build output includes the `dashboard` lambda.

**Live URL: https://talvex-chi.vercel.app**

`talvex.vercel.app` itself returns **451**: the subdomain belongs to another
account. `talvex-chi.vercel.app` is Vercel's auto assigned nearest available
name and is what Task 6's "or nearest available" clause covers.

## 10:40 — Verification sweep of the live deployment

| Route | Status | Reading |
|---|---|---|
| `/` | 200 | marketing placeholder, `<title>Talvex</title>` |
| `/sign-in` | 200 | renders the Clerk SignIn widget |
| `/sign-up` | 200 | renders |
| `/dashboard` | **404** | see below |
| `/select-org` | **404** | see below |
| `/api/webhooks/clerk` | 405 | route exists, correctly rejects GET |

Confirmed the client bundle loads Clerk from `clerk.accounts.dev` using a
`pk_test` key, consistent with the development instance decision.

## 10:41 — Finding: protected routes 404 instead of redirecting

`/dashboard` returns 404 for a signed out visitor. Response headers give the
cause outright:

```
x-clerk-auth-status: signed-out
x-clerk-auth-reason: protect-rewrite, dev-browser-missing
```

`dev-browser-missing` is specific to Clerk **development** instances. A
development instance establishes session context on a deployed domain using a
dev browser token; with no such token present, `auth.protect()` rewrites to 404
rather than redirecting to the sign in page. `src/proxy.ts` documents the
intended behaviour as "redirects signed out users to the sign in page rather
than returning a 404" — true on localhost and in the Task 3 test, **not true on
a deployed development instance**.

Impact is narrower than it first looks. A visitor entering through the front
door (`/` → sign in → Google → dashboard) picks up the dev browser token during
the handshake and lands on a working dashboard. Only a visitor who deep links
straight to `/dashboard` without ever having signed in sees the 404.

This is nonetheless a real cost of the development keys decision that was not
visible when the decision was made, and it is larger than the "banner plus user
cap" that was presented. Surfaced to the operator for a reconsider rather than
silently accepted. A Clerk production instance on an owned domain removes it.

---

# Blocked on a human — queued work

Three items cannot be completed without a browser. They are ordered by how much
they matter.

## 1. Production Clerk webhook, and its signing secret (blocking)

Without this the deployed app cannot sync organizations into Supabase: creating
an org in Clerk will not create the row in `public.organizations`, so the
dashboard and every future tenant query see nothing. Clerk manages webhook
endpoints through Svix rather than its Backend API, so there is no supported
way to script this.

1. Clerk Dashboard → the **Talvex** application → **Configure** → **Webhooks**
   → **Add Endpoint**.
2. Endpoint URL: `https://talvex-chi.vercel.app/api/webhooks/clerk`
3. Subscribe to exactly these six events, which are the ones
   `src/lib/db/clerk-sync.ts` handles. Anything else is ignored by the route:
   - `organization.created`
   - `organization.updated`
   - `organization.deleted`
   - `organizationMembership.created`
   - `organizationMembership.updated`
   - `organizationMembership.deleted`
4. Create it, then copy the **Signing Secret** (starts `whsec_`).
5. Put it into Vercel yourself, so the secret never passes through a chat
   transcript. From the repository root:

   ```sh
   npx vercel env add CLERK_WEBHOOK_SIGNING_SECRET production --value 'whsec_...' --yes
   ```

   Or paste it in the Vercel dashboard under Settings → Environment Variables.
6. Redeploy so the new variable is picked up. Environment variables are read at
   deploy time, so the running deployment will not see it until you do:

   ```sh
   npx vercel redeploy https://talvex-chi.vercel.app
   ```

7. Confirm with Clerk's "Send test event" on the endpoint. A correct setup
   returns 200. A 400 means the signature failed, which means the secret in
   Vercel does not match the endpoint.

Note: if `.env.local` already holds a `whsec_` secret from Task 4, it belongs to
whatever endpoint was created then. Signing secrets are per endpoint, so reusing
it for a new endpoint will fail verification. Use the secret from the endpoint
you create in step 4.

## 2. Preview environment variables (not blocking)

Preview deployments currently have no environment variables, so preview builds
of future pull requests will not have working auth or database access. The CLI
cannot set "all Preview branches" non interactively (see the 10:37 failure), so
this is a dashboard job:

Vercel → project **talvex** → Settings → Environment Variables. For each of the
seven variables that already exist in Production, tick **Preview** as an
additional target. `CLERK_WEBHOOK_SIGNING_SECRET` does not need a Preview value
unless you intend to point a Clerk endpoint at a preview URL.

## 3. Google OAuth application (queued, optional today)

Not required for the current deploy: the development instance uses Clerk's
shared Google credentials and Google sign in works today. It becomes mandatory
the moment you move to a Clerk production instance, and doing it now is what
Task 0's note asked for. It removes the `accounts.dev` domain from the Google
consent screen.

1. Google Cloud Console → create or select a project for Talvex.
2. APIs & Services → OAuth consent screen. External user type. Fill in app
   name, support email, and developer contact.
3. Credentials → Create Credentials → OAuth client ID → Web application.
4. Authorized redirect URI: copy the exact value Clerk shows for the Google
   connection. Clerk Dashboard → **User & Authentication** → **Social
   Connections** → **Google** → toggle off "Use shared credentials", and Clerk
   displays the redirect URI to paste into Google.
5. Copy the Google Client ID and Client Secret back into that Clerk screen and
   save.
6. Re test Google sign in on the live URL.

---

# Manual verification checklist

What a human needs to confirm on https://talvex-chi.vercel.app that no script
can. Do item 1 of the queued work first, or steps 5 and 6 below will fail for a
reason that has nothing to do with your account.

**Start at the home page every time.** Do not paste `/dashboard` into the
address bar as your first action; that path 404s by design on this instance
(see the 10:41 entry) and will send you chasing a bug that is not there.

- [ ] **1. Home page.** Visit the live URL. The page renders and the tab title
      reads "Talvex".
- [ ] **2. Development banner.** Expect a Clerk development mode banner. Its
      presence is correct for this deploy, not a defect.
- [ ] **3. Sign in.** Click through to sign in. The Clerk widget appears with a
      Google button.
- [ ] **4. Google sign in.** Complete it. Expect the consent screen to name an
      `accounts.dev` domain; that is the shared development credential and is
      what queued item 3 replaces.
- [ ] **5. Organization creation.** You should be required to pick or create an
      organization; a personal workspace must not be offered, because
      `hidePersonal` and `force_organization_selection` are on. Create one.
- [ ] **6. Dashboard.** You land on `/dashboard` and it shows a `userId`, an
      `orgId`, and an `orgRole`. All three must be populated. A blank `orgId`
      means the session has no active organization and every future tenant
      query would silently return nothing.
- [ ] **7. Supabase sync.** In the Supabase dashboard, table editor,
      `public.organizations`: a row exists whose `clerk_org_id` matches the
      `orgId` from step 6, and `public.org_members` has your `clerk_user_id`
      against it. **This is the real test of queued item 1.** If the row is
      missing, the webhook is not delivering; check the endpoint's delivery log
      in Clerk for a non 200 response.
- [ ] **8. Second organization and switching.** Create a second org from the
      switcher and switch between them. The dashboard `orgId` changes to match.
- [ ] **9. Sign out.** The dashboard becomes unreachable again.

If steps 1 through 6 and 8 pass, the Phase 0 definition of done is met for a
visitor who starts at the home page. Step 7 is what proves the Task 4 webhook
and the Task 5 isolation work are wired to something real in production.

---

# Phase 1 Task 5 — AI chat deploy, and two production faults it surfaced

Operator: Claude Code, under explicit grant from Islam Elsayed on 2026-07-24,
while debugging why the chat and API keys pages 500'd. Timestamps omitted;
recorded in order.

## Fault 1 — the live database was three migrations behind merged code

Both the chat and settings pages threw a raw Postgres error (`{code, details,
hint, message}`) during server render. Cause: the remote project
(`rdfuzadtraxzrrthhnnp`, which backs local dev, preview, and prod, per the
2026-07-23 one project decision) was at migration **005**. Migrations **006**
(the Task 4 incident to ticket bridge), **007** (the BYOK vault), and **008**
(chat) had been applied only to the ephemeral local isolation stack, never to
the remote. So the deployed app queried tables and functions that did not
exist. The Task 4 incident to ticket bridge was therefore also silently broken
in production the whole time, unhit only because nobody created a ticket from
an incident.

Recovery: applied 006 via the Supabase MCP `apply_migration`; 007 and 008 via
the Supabase SQL editor (the automation classifier blocked the larger MCP
writes, correctly, since they target the prod bound database). Verified the
schema reached 008: all four tables present, `tickets.conversation_id` present,
both SECURITY DEFINER helpers present, RLS enabled on all four, 6 new policies.

**Standing consequence (migration drift):** the remote `schema_migrations`
history and the local migration files have drifted. Remote records 001 to 006
with re stamped timestamps for 001 to 004 and 006, and does NOT record 007 or
008 at all (they went in through the SQL editor, which does not touch
`schema_migrations`). `supabase db push` is broken as a result: it would try to
re apply 001 to 004 (version mismatch) and would not know 007 and 008 are
already live. Until repaired, migrations reach this project by hand. Promoted
to a housekeeping task in docs/future_update.md (migration history repair plus
the still pending 001/002 GRANTs backfill). This is the second time in two days
merged code assumed schema the live database did not have; the repair is now
the priority housekeeping PR, not parking lot.

## Fault 2 — org_members had zero rows: membership sync never worked in prod

With the pages loading, the API keys surface showed "Key management is
available to admins" to the org owner. `is_org_admin()` reads
`org_members.role` (the database column, not the token claim, by Task 3 design),
and `public.org_members` had **zero rows ever**, for any org. So every admin
gated feature since tickets merged (ticket status changes, and now key
management) has been non functional in production, unnoticed only because the
founding user was testing alone and every non admin path worked. Deploy Log
step 7 above is exactly the check that would have caught this and was not
completed.

Cause: at org creation time (2026-07-23 17:56 UTC) the Clerk webhook endpoint
was subscribed to `organization.*` but not `organizationMembership.*`, so
`organization.created` synced the org while the creator's
`organizationMembership.created` was never delivered. The membership events are
subscribed now (verified in the Clerk dashboard), so future memberships and role
changes sync through the existing, correct handler
(src/lib/db/clerk-sync.ts); Clerk does not replay the original event, so the
existing membership needed a one time backfill.

Recovery: **org_members backfilled by hand for the founding user**
(`user_3GpHQamrYPUh8ZB8fCUiYhHfNV3`) as `admin` in org
`org_3GpHSviwFRQ9T2PRfDAtrMevjRd`; **membership events were unsubscribed at org
creation time; future syncs verified subscribed.** The user id was recovered
from the one existing ticket's `submitted_by` (ticket creation does not require
a member row, which is why that path worked). No code change: the handler was
always correct; only the subscription and the one missing row were wrong.

**Watch item:** confirm future membership sync works before relying on it. When
a second member is added, check Clerk → Webhooks → Message Attempts for a 200 on
`organizationMembership.created`, and that a matching `org_members` row appears.




---

## 2026-07-24 — Migration history repair on the shared project

Not a deploy. A production database change, recorded here because it touched
the one shared project (`rdfuzadtraxzrrthhnnp`) outside a normal deploy, and
because the state it fixed is what caused the two faults above.

Operator: Claude Code, under explicit grant from Islam Elsayed on 2026-07-24.
Scope granted: realign the remote migration history so `supabase db push`
works again. Nothing else on the remote was authorized and nothing else was
touched.

**State before.** `supabase_migrations.schema_migrations` recorded six
migrations, five of them under versions that matched no file in the repository
(001 to 004 and 006 carried re stamped timestamps), and did not record 007 or
008 at all, which had been applied by hand in the SQL editor. Local files ran
`20260721190000_001` through `20260724100100_008`.

**Verified before touching anything.** That the schema itself was genuinely at
008, so stamping 007 and 008 applied would be recording a fact rather than
asserting one: both tables from 007 and both from 008 present, their policies
present (`org_api_keys` 1, `api_key_events` 1, `chat_conversations` 3,
`chat_messages` 1), every function present, `tickets.conversation_id` and the
`tickets_single_origin` constraint present, and zero tables in `public` with
RLS disabled. The pre repair contents of the history table were captured
verbatim first, with a rollback script written against them.

**What ran.** One transaction: five `update`s moving the drifted versions onto
their local file versions, and one `insert` recording 007 and 008 with NULL
`statements`, which is exactly how `supabase migration repair --status applied`
records a migration whose text it does not have. `update` rather than delete
and reinsert, so the recorded `statements` of the five drifted rows survived.
005 already carried its local version and was not touched.

**State after.** Eight rows, eight files, versions and names matching one for
one. Nothing outside `supabase_migrations` was read or written; no schema, no
policy, no tenant row changed.

**What this unblocks.** `supabase db push` is usable again, and the SQL editor
dance is retired. Migration 009 (the 001/002 GRANTs backfill) is deliberately
NOT applied here: it ships in the same pull request as this log entry and is
not merged yet. Apply it to the shared project before merging that PR, so main
is never ahead of the database, which is precisely what the new
`migration-drift` CI job now checks.
