# Talvex — Decision Log

Architectural and process decisions, newest on top. Each entry records what
was decided, why, and what it affects. Add an entry when a choice constrains
future work; do not log routine implementation details.

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
