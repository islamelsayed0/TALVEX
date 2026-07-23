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

### Process
9. Work in small branches, open PRs, let CI go green before merge. Never
   push directly to main.
10. When a task is ambiguous, check docs/BRD.md first, then ask, in that
    order. Do not invent requirements.

## Writing style for user facing copy
Professional, human, short sentences. No robotic filler. No hyphens in any
user facing text (product copy, emails, marketing); use en dashes or rewrite.

## Current phase
Phase 1: core features. Scope is monitors, incidents, tickets, AI chat, and
the incident to ticket bridge, in that order, one feature per PR. The landing
page remains out of scope until the end of MVP. Phase 0 rules all remain in
force.
