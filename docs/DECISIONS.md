# Talvex — Decision Log

Architectural and process decisions, newest on top. Each entry records what
was decided, why, and what it affects. Add an entry when a choice constrains
future work; do not log routine implementation details.

---

## 2026-07-22 — Phase 0 ships on a Clerk development instance, and what that costs

**Decided.** The Phase 0 production deploy runs at
`https://talvex-chi.vercel.app` on Clerk **development** keys (`pk_test_`). No
domain was purchased. The plain `talvex.vercel.app` subdomain is taken by
another account and returns 451, so Vercel's auto assigned
`talvex-chi.vercel.app` is the "nearest available" name Task 6 allows.

**Why.** A Clerk production instance requires DNS records (`clerk.<domain>`,
`accounts.<domain>`, and email records) on a domain you control. Those records
cannot be added to a `*.vercel.app` subdomain because Vercel owns that zone. So
"production deploy on the free vercel.app subdomain" and "Clerk production
instance" are mutually exclusive; one of them had to give. BRD section 9.1
budgets the domain at roughly 12 dollars a year and defers it until there is a
reason to look professional to a paying stranger, so the domain gave.

**What it actually costs, including one thing we did not anticipate.** The
known costs were a Clerk development banner, a Google consent screen showing an
`accounts.dev` domain, and a development instance user cap. Verification of the
live deploy turned up a fourth, larger one: **protected routes return 404 to
signed out visitors instead of redirecting to sign in.** The response carries
`x-clerk-auth-reason: protect-rewrite, dev-browser-missing`. A development
instance establishes session context on a deployed domain through a dev browser
token; with no token present, `auth.protect()` rewrites to 404 rather than
redirecting. This contradicts the behaviour `src/proxy.ts` documents and that
the Task 3 test proves, both of which are correct on localhost and on a
production instance. A visitor entering through the home page and signing in is
unaffected, because the handshake sets the token; only a cold deep link to
`/dashboard` or `/select-org` hits it.

**Affects.** The live URL is usable as a demo but is not yet the portfolio
artifact BRD C5 wants, and the Phase 0 definition of done ("a stranger can
visit the live URL, sign in with Google, create an organization") holds only
for a stranger who starts at the home page. Upgrading is a self contained
sequence, not a rewrite: buy a domain, point it at the Vercel project, create a
Clerk production instance with our own Google OAuth credentials, re register the
new Clerk domain in Supabase third party auth (the third party auth entry
below), reissue the Clerk environment variables in Vercel, and recreate the
webhook endpoint against the new instance. The RLS claim pattern does not
change, so no migration is involved. Until then, do not read the deployed 404
as a routing bug; it is this decision showing through.

---

## 2026-07-22 — Isolation is proven against an ephemeral local Supabase stack with self minted JWTs

**Decided.** The tenant isolation suite (`tests/isolation/`) runs against a
local Supabase stack started by the pinned CLI (`supabase` in devDependencies,
exact version), both on developer machines and in CI. `supabase/config.toml`
starts only Postgres, Kong, PostgREST, and GoTrue; migrations apply from zero
on every start. GoTrue is never called by the tests, but disabling it also
removes the auth schema helpers (`auth.jwt()`) that every RLS policy reads,
so it runs. The tests mint their own HS256 JWTs with the CLI's fixed, published
local development secret, carrying the Clerk claim shapes from the entry
below, one token per shape. CI holds no cloud credentials of any kind. When
the stack is not running the suite fails loudly with the command that fixes
it; it never skips.

**Why.** RLS can only be proven by a real Postgres and a real PostgREST
evaluating the real policies under a real token; mocks would prove nothing.
The alternatives all put credentials somewhere: pointing CI at the real
project puts the RLS bypassing service role key in GitHub secrets and writes
test rows into the production bound database on every PR; a persistent cloud
test project still needs secrets, pauses after a week idle on the free tier
(silently bricking CI), and drifts. The local stack needs neither Clerk nor
Supabase accounts because the policies never talk to Clerk: they read claims
from whatever verified JWT arrives, so a token signed with the stack's own
secret and shaped like Clerk's exercises exactly the production code path.
Self minting also lets the suite test BOTH claim shapes of the coalesce,
which no single real Clerk token can do. Bonus: every PR now proves the
migrations replay cleanly from an empty database.

**Affects.** Every tenant table added after this gets its cases in
`tests/isolation/` against this stack (CLAUDE.md rules 2 and 8). Running the
full test suite now requires Docker plus `npm run db:start`; after a new
migration, `npm run db:reset`. CI's quality job boots the stack (a few
minutes of image pulls per run; image caching is a known future optimization,
weakening the test is not). The local dev JWT secret literal in
`tests/isolation/local-stack.ts` is intentionally committed with a gitleaks
allow marker: it is a published constant shared by every local Supabase stack
in the world, not a credential. If the local stack ever moves to asymmetric
signing keys, `TALVEX_TEST_SUPABASE_JWT_SECRET` is the escape hatch.

---

## 2026-07-21 — Every session carries an organization: hidePersonal on the switcher

**Decided.** The organization switcher in the dashboard header is rendered with
`hidePersonal`, so a user cannot select a personal workspace. Clerk's instance
config backs this up with `force_organization_selection` enabled. Every
authenticated session therefore has an active organization.

**Why.** Tenancy is not a UI preference here, it is the thing the database
relies on. Every RLS policy reads the organization claim from the Clerk token,
using the pattern in the entry below:

```sql
organization_id = (select coalesce(auth.jwt()->>'org_id', auth.jwt()->'o'->>'id'))
```

A personal workspace produces a session with no organization id. That claim
then resolves to null, the predicate matches nothing, and every query silently
returns zero rows. The failure looks like an empty dashboard rather than an
error, which is the worst kind: it is indistinguishable from a tenant that
genuinely has no data, so it would be diagnosed as a bug in whatever feature
happened to be on screen. Closing the hole at the session boundary means no
query is ever issued without a tenant to scope it to.

**Affects.** The data layer in `src/lib/db/` from Task 4 onward may treat an
active organization as a precondition rather than an optional value, but it
must not assume the invariant holds silently. `hidePersonal` is a UI control,
and UI controls are not a security boundary: it stops the switcher offering a
personal workspace, it does not stop a request arriving without an org. Task 4
still needs an explicit server side decision, redirect or hard error, for a
request whose token has no organization id. `src/app/dashboard/page.tsx`
currently surfaces the active `userId`, `orgId`, and `orgRole` so a session
missing its organization is visible immediately rather than at query time.

---

## 2026-07-21 — Clerk to Supabase auth path: third party auth, not JWT templates

**Decided.** Clerk is wired to Supabase as a third party auth provider. The
Clerk session token is passed directly as the Supabase access token, via the
`accessToken` option on the Supabase client. We do not create a Supabase JWT
template in Clerk, and we do not copy the Supabase JWT secret into Clerk.

**Why.** The older Clerk integration with Supabase, which used a configurable
JWT secret and a Clerk JWT template, was deprecated on 1 April 2025 and is no
longer recommended. Third party auth is the supported path.
Reference: https://supabase.com/docs/guides/auth/third-party/clerk

**The claim pattern every tenant policy uses.** Clerk puts the active
organization id in the token. Two claim shapes exist, the legacy `org_id` and
the v2 `o.id`, so policies must read both:

```sql
organization_id = (select coalesce(auth.jwt()->>'org_id', auth.jwt()->'o'->>'id'))
```

The role check follows the same dual shape:

```sql
((select auth.jwt()->>'org_role') = 'org:admin') or ((select auth.jwt()->'o'->>'rol') = 'admin')
```

The `coalesce` is not optional. Dropping it silently breaks isolation for
whichever claim shape is not handled.

**Affects.** Every RLS policy written from Task 4 onward, both tables in
migration 001 and every tenant table after them. Also the data layer in
`src/lib/db/`: queries must run through a request scoped client carrying the
user's Clerk token, because a client built with the service role key bypasses
RLS entirely. The service role client stays a separate, narrowly used export.

---

## 2026-07-21 — CI secret scan needs an explicit permissions block

**Decided.** The `secret-scan` job in `.github/workflows/ci.yml` declares its
own permissions, `contents: read` and `pull-requests: write`, and nothing more.

**Why.** The job failed in 8 seconds with HTTP 403, "Resource not accessible
by integration". GitHub now issues a read only workflow token by default, so
gitleaks could not list the pull request's commits or write findings back onto
the PR. The first suspected cause, that gitleaks-action requires a paid
license for organization owned repositories, was wrong: that limit is real for
org owned repos but was not what failed here, and this repo is owned by a
personal account. Diagnosing from the job log rather than the assumption is
what found it.

**Affects.** Any future workflow job that calls the GitHub API needs the same
treatment: grant the narrowest scopes on that job instead of loosening the
repository wide default. The `quality` job keeps the restrictive default.

---

## 2026-07-21 — .gitignore exception for .env.example, backed by a test

**Decided.** `.gitignore` keeps the `.env*` pattern from create-next-app and
adds `!.env.example` immediately after it.

**Why.** Task 1 requires a committed `.env.example` documenting every variable
name. The generated `.env*` pattern would have ignored that file silently, so
the template would never have reached the repository while appearing to be
present locally. Real env files stay ignored; only the placeholder template is
tracked.

**Guarded by a test, not by discipline.** `tests/env-hygiene.test.ts` asserts
the ignore rules hold, that every required variable is documented, that the
template carries only placeholder values, and that no `NEXT_PUBLIC_` name
contains `SECRET`, `SERVICE_ROLE`, or `PRIVATE`. It was verified as a real
guard: planting a realistically shaped `sk_test_` key in `.env.example` makes
it fail, and removing the key makes it pass. A test that cannot fail proves
nothing, so new hygiene rules added here get the same negative check.

**Affects.** Adding an environment variable now means updating `.env.example`
and the list in that test, or CI fails. This is intentional.
