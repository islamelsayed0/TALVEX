# Talvex — Phase 0 Build Plan

Goal: a deployed, authenticated, multitenant app shell with CI enforcing
quality and a proven tenant isolation test. No product features yet. When
this list is done, Phase 1 (monitors, tickets, chat) begins.

Each task is one Claude Code session or less. Do them IN ORDER; later tasks
assume earlier ones. Commit and merge each task through a PR so CI runs.

---

## Task 0: Prerequisites (human, not Claude Code)
Do these yourself in a browser before starting:
- [ ] GitHub organization `talvex` created; this repo lives under it
      NOT DONE, and deliberately deferred. The repo lives at
      `islamelsayed0/TALVEX` under the personal account instead. Branch
      protection on a private repo requires GitHub Pro, so the repo was made
      public, which also gives unlimited Actions minutes and serves as the
      portfolio artifact (BRD C5). Transfer to an org later if needed.
- [x] Clerk account + new application named Talvex; enable Google as a
      sign in method; enable Organizations; copy the two API keys
      Google uses Clerk's shared development credentials, which is fine for
      development but needs our own Google OAuth app before Task 6.
- [ ] Supabase account + new project named talvex; copy the project URL,
      anon key, and service role key
      PARTIAL. Project created, ref `rdfuzadtraxzrrthhnnp`, us-east-1, and the
      URL and publishable key are in `.env.local` and Vercel. The service role
      key is NOT copied yet; it is not exposed over the API and needs the
      dashboard. See the prerequisite note on Task 4, which is where it is
      first needed.
- [x] Vercel account connected to the GitHub org
      Project `talvex` linked, GitHub repo connected, and the four known env
      vars set across production, preview, and development.

## Task 1: Scaffold
- Scaffold Next.js with TypeScript, Tailwind, ESLint, App Router, src dir:
  `npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir`
- Add `.env.local` to .gitignore (verify, do not assume)
- Create `.env.example` listing every env var name with placeholder values
  and a one line comment each (Clerk keys, Supabase URL and keys)
- Create folders: `src/lib/db/`, `tests/isolation/`, `docs/`
- Move BRD.md and this file into `docs/`
- First commit direct to main (the only one allowed), push

## Task 2: CI online
- Add the prepared workflow file at `.github/workflows/ci.yml`
- Add npm scripts it expects: `lint`, `test` (Vitest, one placeholder test)
- Open a PR with a trivial change; confirm both jobs (quality, secret-scan)
  run and go green; merge
- Then in GitHub settings: protect `main`, require the CI checks to pass
  and require PRs before merging
- LEARNING CHECKPOINT: read the Actions run logs top to bottom once. Watch
  the runner boot, install, test, and die. This is the robot doing chores.

## Task 3: Auth shell (Clerk)
- Install and configure Clerk with the App Router middleware
- Enable Google sign in flow end to end locally
- Routes: `/` (public marketing placeholder), `/sign-in`, `/sign-up`,
  `/dashboard` (protected, requires session)
- Enable Clerk Organizations: org switcher component in the dashboard
  header; creating an org and switching between two orgs must work
- Test: middleware blocks `/dashboard` when signed out (redirects)

## Task 4: Database foundation (Supabase + RLS)
BEFORE THIS TASK (human, in a browser):
  1. Copy the service role key from the Supabase dashboard (Settings > API)
     into `.env.local` and into Vercel. It is empty in both today.
  2. Create the Clerk webhook endpoint and copy its signing secret into
     `.env.local`, `.env.example`, and Vercel. The webhook route below cannot
     verify signatures without it.

- Register Clerk as a Supabase THIRD PARTY AUTH provider, so the Clerk session
  token is the Supabase token. Do NOT create a Supabase JWT template in Clerk:
  that integration was deprecated on 1 April 2025. See docs/DECISIONS.md
- Install Supabase client; wire env vars; typed client in `src/lib/db/` that
  forwards the Clerk token via the `accessToken` option, so queries run as the
  user under RLS. Keep the service role client separate: it bypasses RLS
- Migration 001 creates:
  - `organizations` (id, clerk_org_id unique, name, created_at)
  - `org_members` (org_id FK, clerk_user_id, role check: owner/admin/
    technician/member, created_at; unique on org_id + clerk_user_id)
- Enable RLS on BOTH tables from the same migration. Policies: members can
  select only rows belonging to orgs they are members of; only owners and
  admins can insert or update membership rows. Scope every policy with the
  claim pattern recorded in docs/DECISIONS.md:
  `coalesce(auth.jwt()->>'org_id', auth.jwt()->'o'->>'id')`. Both claim shapes
  must be read; dropping the coalesce silently breaks isolation
- Clerk webhook route (`/api/webhooks/clerk`) syncs org creation and
  membership changes into these tables; verify webhook signature
- Document in `docs/DECISIONS.md`: how Clerk identity maps to RLS policies
  (this becomes interview material)

## Task 5: The isolation proof
- `tests/isolation/tenant-isolation.test.ts`:
  1. Seed two orgs (A, B) and one member in each
  2. As A's member, query organizations and org_members
  3. Assert B's rows are NOT returned, and direct selects of B's ids
     return empty, not errors
- Wire this test into the CI `test` script so it runs on every PR
- This test is the single most important artifact in Phase 0. It is the
  demo answer to "how do you know tenants are isolated?"

## Task 6: Deploy
- Connect repo to Vercel; set all env vars in the Vercel dashboard
- Production deploy on the free `talvex.vercel.app` style subdomain (or
  nearest available)
- Confirm the live URL: sign in with Google, create an org, see dashboard
- Add the URL to the repo README with one paragraph describing the project

## Task 7: Design system pass (separate day, Claude Design)
- Produce: wordmark treatment for "Talvex", color palette, typography
  choices, button/card/input styles
- Apply to the app shell (dashboard layout, sign in pages) so every screen
  built in Phase 1 inherits an intentional look
- Landing page is NOT in scope; it comes at the end of the MVP and will be
  assembled from this design system

---

## Definition of done for Phase 0
A stranger can visit the live URL, sign in with Google, create an
organization, and see an empty dashboard that looks intentionally designed.
CI blocks any PR that fails typecheck, lint, tests, or leaks a secret. The
tenant isolation test passes on every merge. Nothing else exists yet, and
that is correct.
