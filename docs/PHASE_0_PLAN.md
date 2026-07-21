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
- [ ] Clerk account + new application named Talvex; enable Google as a
      sign in method; enable Organizations; copy the two API keys
- [ ] Supabase account + new project named talvex; copy the project URL,
      anon key, and service role key
- [ ] Vercel account connected to the GitHub org

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
- Install Supabase client; wire env vars; typed client in `src/lib/db/`
- Migration 001 creates:
  - `organizations` (id, clerk_org_id unique, name, created_at)
  - `org_members` (org_id FK, clerk_user_id, role check: owner/admin/
    technician/member, created_at; unique on org_id + clerk_user_id)
- Enable RLS on BOTH tables from the same migration. Policies: members can
  select only rows belonging to orgs they are members of; only owners and
  admins can insert or update membership rows
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
