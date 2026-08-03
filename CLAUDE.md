# CLAUDE.md — Talvex Project Conventions

## What this project is
Talvex is an all in one IT operations platform: uptime monitoring, incidents,
ticketing, AI support chat, client status pages, and usage metering, built as
a multitenant SaaS. It merges two predecessor projects: NetPulse (monitoring,
the architectural base) and HelpMe Hub (helpdesk features, being ported from
Django to this codebase). The full requirements live in docs/BRD.md. Read it
before making product decisions.

## Stack (locked, do not substitute)
- Next.js (App Router) + TypeScript, single app, no separate API service
- Supabase Postgres with Row Level Security for ALL tenant data
- Clerk for auth (Google SSO enabled, Clerk Organizations for tenancy)
- Tailwind + shadcn/ui for components
- Vercel for hosting, npm for packages (not pnpm, not yarn, not bun)
- Vitest for unit tests, Playwright for end to end tests

## Non negotiable rules

### Security
1. NEVER commit secrets. All secrets live in .env.local (gitignored) and in
   Vercel environment variables. If you find a secret in code, stop and flag it.
2. Every table holding org data MUST have RLS enabled with policies scoping
   rows to the member's organization. No exceptions, no "we'll add it later."
3. All AI provider calls happen server side only. API keys (platform or BYOK)
   must never reach the browser bundle, client components, logs, or errors.
4. Environment variables exposed to the client (NEXT_PUBLIC_*) may never
   contain anything sensitive.

### Code
5. TypeScript strict mode stays on. Do not add ts-ignore to silence errors;
   fix the types.
6. Server components by default; client components only when interactivity
   requires it.
7. Database access goes through a single typed data layer (src/lib/db/).
   No inline SQL scattered through components.
8. Every feature PR includes at least one test. The tenant isolation tests
   in tests/isolation/ must never be skipped, weakened, or deleted.

### Accessibility
We publish a public commitment at /accessibility to WCAG 2.2 Level AA. These
rules are what keep that sentence true, so they are not style preferences.

9. **No state is ever communicated by color alone.** Every status indicator
   pairs its color with a shape and a text label. The five shapes are fixed in
   src/components/status-mark.tsx (circle up, diamond down, ring pending,
   square in progress, bar paused); a new status maps onto one of them or the
   vocabulary grows deliberately. A link inside a sentence is underlined, not
   just tinted. Never ship a bare colored dot.
10. **Focus is always visible.** One token, one global `:focus-visible` rule in
    globals.css, at least 2px. No component removes a focus style without
    replacing it, and `outline-none` is banned outright: the layer order means
    that utility silently beats the global rule, so tests/a11y-foundation.test.ts
    fails the build if it reappears.
11. **Every page has one h1, a `<main id="main-content">`, and a logical
    heading order.** The skip link in the root layout targets that id. Icon
    only buttons get an aria-label; decorative images get `alt=""`.
12. **eslint-plugin-jsx-a11y runs in the CI lint job**, and
    tests/e2e/accessibility.spec.mjs runs axe over the real running app,
    failing on any serious or critical violation. Default rule exclusions:
    zero. The one configured rule carries its reason inline.

### Process
13. Work in small branches, open PRs, let CI go green before merge. Never
    push directly to main.
14. When a task is ambiguous, check docs/BRD.md first, then ask, in that
    order. Do not invent requirements.

## Writing style for user facing copy
Professional, human, short sentences. No robotic filler. No hyphens in any
user facing text (product copy, emails, marketing); use en dashes or rewrite.

## Current phase
Portfolio close out. The foundation is complete and the feature era is behind
us: BRD F1 to F12 have shipped, plus F14 (knowledge base) and F15 (inventory)
out of Phase 2, plus the public landing page, plus a platform hardening block
(rate limits, an external watcher, an operator error channel, self monitoring,
a drilled restore, a pre commit secret scan). Where the build differs from the
BRD, the difference is recorded in docs/DECISIONS.md, which supersedes the BRD.

The work in front of us is not features. It is the thing the BRD names as
purpose number one: interview material. README, an architecture diagram and
technical write up, a demo script, a runbook for the domain and the Clerk
production instance. One ticket lifecycle task is queued after that.

Phase 0 and Phase 1 rules all remain in force. In particular: no direct pushes
to main, every feature PR carries a test, the tenant isolation suite in
tests/isolation/ is never skipped or weakened, and the migration drift guard is
never merged over.
