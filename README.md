# TALVEX

**Live: https://talvex-chi.vercel.app**

Talvex is an all in one IT operations platform for small IT teams and the
consultants who serve them. It puts uptime monitoring, incident management,
ticketing, AI support chat, client status pages, and usage metering in one
multitenant SaaS, so an outage and the tickets it causes finally live in the
same system. Every organization's data is isolated at the database by Postgres
row level security, not by application code alone, and that isolation is proven
on every pull request by the test suite in [tests/isolation/](tests/isolation/).
The product merges two predecessor projects: NetPulse, which contributes the
monitoring core and the architectural base, and HelpMe Hub, whose helpdesk
features are being ported from Django. A signature feature is BYOK: an
organization can plug in its own AI provider key instead of paying platform AI
markup.

Full requirements live in [docs/BRD.md](docs/BRD.md); the current build plan is
[docs/PHASE_0_PLAN.md](docs/PHASE_0_PLAN.md) and the decisions that shaped the
build are in [docs/DECISIONS.md](docs/DECISIONS.md).

> Phase 0 status: the deployment above runs on a Clerk development instance, so
> it shows a Clerk development banner and deep links to `/dashboard` return 404
> until you sign in through the home page. See docs/DECISIONS.md for why, and
> the upgrade path.

## Local development

Prerequisites: Node 22, npm, and Docker (for the local database).

```sh
npm ci              # install dependencies (includes the pinned Supabase CLI)
npm run db:start    # start the local Supabase stack; applies supabase/migrations/
npm test            # unit tests + the tenant isolation suite
npm run dev         # the app itself (needs .env.local, see .env.example)
npm run db:stop     # stop the stack when done
```

After adding a migration, rebuild the local schema with `npm run db:reset`.

The tenant isolation tests in `tests/isolation/` prove, against a real
Postgres with real row level security, that one organization can never read
another organization's rows. They need the local stack running; without it
they fail with instructions rather than skip. That is by design and is not
to be changed (see CLAUDE.md rule 8 and docs/DECISIONS.md). CI starts the
same stack on every pull request, with no cloud credentials involved.
