# TALVEX

All in one IT operations platform: uptime monitoring, incidents, ticketing,
AI support chat, client status pages, and usage metering, built as a
multitenant SaaS. Full requirements live in [docs/BRD.md](docs/BRD.md);
the current build plan is [docs/PHASE_0_PLAN.md](docs/PHASE_0_PLAN.md).

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
