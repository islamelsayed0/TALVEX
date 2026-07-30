# Talvex — Future Updates

A running list of enhancements we want but are deliberately not building yet,
so the idea is captured without pulling scope into the current task. Newest on
top. Each entry says what, why, and enough of the how that whoever picks it up
is not starting cold. Promote an item into a real task when its phase comes.

Shipped, so no longer listed here: the migration history repair and the 001/002
GRANTs backfill (2026-07-24), which also removed `auto_expose_new_tables` and
added the CI migration drift guard. See docs/DECISIONS.md for all three.

---

## Process: the chat isolation CI flake, carried as a known cost

**Raised 2026-07-30**, at the portfolio close out, so the cost is written down
rather than absorbed silently every time it happens.

**What is observed.** `tests/isolation/chat-isolation.test.ts` has failed during
its seeding step with an error raised upstream of the assertions, on a run where
nothing in the chat suite, the chat code, or migration 008 had been touched. The
same commit passes when the job is rerun. Nothing about the failure implicates
the change under test, which is exactly what makes it expensive: the first
reading of a red isolation check is always "this branch broke tenant
isolation", and that reading costs real attention before the rerun clears it.

**Why it is not chased now.** A flake that has not been captured has not been
diagnosed. **No run log in the repository's Actions history records this
failure**, which is the honest state of the evidence: it has been seen, and it
has not been kept. Chasing it therefore starts by keeping one, not by
theorizing, and that is a debugging session rather than a task.

**What picking it up looks like.**

1. **Capture one.** The next time it goes red, save the job log before
   rerunning. `gh run view <id> --log-failed > flake.log` takes a second and is
   the whole difference between an anecdote and a bug report.
2. **Read the seeding path specifically.** The suite seeds through PostgREST
   against a stack that has just started. The candidates worth eliminating in
   order: PostgREST's schema cache not yet reloaded after `supabase start`, so
   an insert hits a table the API layer does not know about yet; a container not
   fully healthy when the first request lands; and the clock skew rejection
   (PGRST303) that `src/lib/db/fetch-retry.ts` already exists to absorb in the
   app, which the isolation suite's own client does not use.
3. **Fix the cause, never the symptom.** A retry wrapper around the seed is
   acceptable if the cause is genuinely a readiness race and the retry is
   scoped to seeding. Loosening, skipping, or conditionally running an isolation
   assertion is not, under any diagnosis (CLAUDE.md rule 8).

**The cost of leaving it.** A rerun. The risk is habituation: a suite that is
sometimes red for no reason trains its reader to rerun first and think second,
and that is precisely the reflex that would wave through a real isolation
failure one day.

**Raised 2026-07-27** after the monitor sweep silently stopped: cron-job.org
had auto disabled the job (405, because it was POSTing to a route that only
had GET deployed at the time), and separately the live `CRON_SECRET` had
drifted from `.env.local`, so authenticated calls 401'd. Both were invisible
until an email arrived and chat also failed to decrypt its key. See the
2026-07-27 external scheduler decision, which names this residual: nothing
watches the watcher.

**Also learned (2026-07-28), F10 email setup.** A Vercel env var only reaches
the app on a build created after it was set, and a plain "Redeploy" can reuse
the original deployment's env snapshot, so `RESEND_API_KEY` read as unset at
runtime until a fresh build (a new commit) picked it up. The self check below
should therefore assert a value is actually visible at runtime, not just that
it exists in the Vercel dashboard.

**What.** Two follow ups.

1. **A heartbeat for the external sweep.** cron-job.org calling the endpoint is
   the only thing keeping monitoring alive, and its own health is unmonitored.
   Add a dead man's switch: record the last successful sweep time (a timestamp
   the sweep writes, or a healthchecks.io style ping the sweep makes at the end)
   and surface a loud "monitoring has not run in N minutes" state on the admin
   dashboard, so a stopped scheduler is visible in the product, not only in a
   cron-job.org email. Vercel Pro cron is the first party alternative if the
   third party residual keeps biting.

2. **A periodic prod config self check.** The outage was really a secret
   alignment drift between `.env.local`, Vercel, and cron-job.org, plus a key
   encrypted under a different `API_KEY_ENCRYPTION_SECRET` than prod runs. Worth
   a small, safe check to run on a schedule (or before each deploy): confirm the
   authenticated sweep returns 200 (secret aligned + service role good) and that
   the chat send path can decrypt at least one org key (secret aligned + key
   re-encrypted under the live secret). Read only, no secrets logged. This is
   the "check back later that everything is still ok" the owner asked for.

**Why not now.** Both are real features (a schema touch for the heartbeat, a
guarded diagnostic endpoint for the self check) that deserve their own task and
tests, not a bolt on while shipping F10. The immediate incident is resolved:
the sweep is green again and chat decrypts. Capture the hardening; build it when
the notifications feature it protects has settled.

---

## Assistant: gate the floating popup on entitlement once billing lands

**Raised 2026-07-27** when the floating Talvex AI popup shipped for everyone. The
popup (`src/app/dashboard/_shell/ask-talvex-widget.tsx`) reuses the BYOK chat, so
today it is effectively gated by the org having a provider key connected: no key,
and it shows a "needs a key" state instead of taking input.

**What.** When Phase 2 billing (F13) and a platform managed AI key (F7's "platform
managed key on paid tiers") exist, the assistant should be usable when the org
**subscribes to the platform AI model** OR **has its own key connected** — and
the popup should reflect that entitlement rather than only BYOK presence. The
current `hasKey` prop from the layout is the seam: replace it with an
`assistantEnabled` entitlement check that is true for a subscribed org or a
BYOK org.

**Why not now.** There is no billing or platform key yet, so entitlement is
exactly "has a BYOK key." Building a gate before there is a second path to gate
on would be speculative. Capture it; wire it when F13 lands.

---

## Ops: verify Clerk membership sync end to end, and consider a self heal

**Raised 2026-07-24** after finding `org_members` had zero rows in production
(docs/DEPLOY_LOG.md, Fault 2): the founding user's
`organizationMembership.created` was never delivered because the event was not
subscribed at org creation time. Backfilled by hand; events are subscribed now.

**What.** Two follow ups. First, a real verification that membership sync works:
add a second member (or a test org) and confirm a 200 on
`organizationMembership.created` in Clerk's Message Attempts and a matching
`org_members` row. Second, consider a small self heal so a missed membership
event is not a silent, permanent admin lockout: for example, a lightweight
reconcile that, when a signed in user's token carries an org admin role claim but
no `org_members` row exists for them, logs it loudly (or, more cautiously,
surfaces a "membership not synced" state on the dashboard, which step 6/7 of the
Phase 0 deploy checklist already gesture at) rather than silently rendering the
member view.

**Why not a bigger fix now.** The handler (src/lib/db/clerk-sync.ts) is correct;
the failure was configuration plus a one time missed event, both resolved. A
self heal that trusts the token claim to write a role row would undermine the
Task 3 decision that the database column, not the claim, is the role authority,
so any reconcile must be read only or admin reviewed, not an automatic role
grant. Capture the idea; design it carefully when membership management (the
owner/technician ladder, docs below) is built.

---

## Chat: let the assistant see the org's live Talvex data (tool use)

**What.** Today the support assistant is stateless about the tenant: it cannot
see this org's monitors, incidents, tickets, devices, or any live Talvex data,
and its system prompt makes it say so plainly and point the user to the right
dashboard page or offer to escalate. The enhancement is to give the assistant
read only tool access over the org's own data, scoped by the same RLS the app
uses, so it can answer "is the mail server down?" or "what is the status of my
ticket?" directly instead of deflecting.

**Why not now.** Tool use over tenant data is a real security surface: every
tool call must run under the caller's RLS (or a tightly scoped equivalent), must
never cross the org boundary, and must never let a prompt injection in a user
message pull data the user could not otherwise see. That is its own design and
isolation test effort, and BRD F14 (knowledge base retrieval) is the more
valuable retrieval feature to build first. The honest deflection is the correct
behavior until the tool layer exists; the assistant never guesses about system
status.

**How (sketch).** A small set of read only tools (monitor status, incident
list, ticket lookup for the caller) exposed to the provider via the abstraction
in `src/lib/chat/providers.ts`, each executed server side through the org scoped
client so RLS filters exactly as it does for the dashboard. Per provider tool
calling differs (Anthropic tools, OpenAI functions, Google function calling),
so the abstraction grows a normalized tool interface. Add isolation tests that a
tool call as org A can never surface org B data, and that a member's tool call
sees only what that member's RLS allows. Update the system prompt's honesty
rules once the assistant genuinely can see the data.

---

## Chat: streaming replies, per org model choice, conversation sharing

**What.** Three deferred chat niceties: stream the assistant reply token by
token instead of the current non streaming "thinking" state; let an admin pick
the model per org (not just the hardcoded cheap default per provider); and let a
member share or export a conversation. Also parked: file uploads into chat and
the managed AI tier (platform key plus metering, BRD F11/F13).

**Why not now.** Task 5 chose non streaming deliberately: streaming three
providers through one abstraction means per provider SSE parsing and partial
state on the client, real complexity for a support chat where replies are
short. Per org model choice needs a settings surface and a place to store the
choice. The managed tier needs billing. Each is a clean follow up, none blocks
the MVP.

**How (sketch).** Streaming: switch the provider abstraction to return a stream
and the route to a `ReadableStream`, and have the client pane append deltas;
persist the full assistant message on completion (the DB write path is
unchanged). Model choice: a nullable `model` column on a per org chat settings
row, defaulting to the current constants in `src/lib/chat/providers.ts`.

---

## Tickets: deleting tickets, submitting on behalf, and a deeper role ladder

**What.** Three ideas raised after using the feature live: let admins remove
tickets, let admins open a ticket for someone else (the walk up and phone
call case), and split the admin tier into a super admin for IT people and a
lighter admin for staff.

**Where things stand today, so the gap is precise.** Resolving needs no new
power: an admin already moves any ticket through open, in progress,
resolved, and closed with the status control, and the sweep closes resolved
tickets after 7 days. What nobody can do is delete a ticket, and everyone
submits only as themselves. Both are deliberate, which is why each idea
below gets a pros and cons pass instead of a straight yes.

**Deleting tickets: pros and cons.**
- *Pros.* Real queues accumulate junk: spam, test submissions, duplicates,
  accidents. Admins will want a broom. Deletion is also the blunt tool for
  privacy requests when a ticket body contains personal information someone
  wants gone.
- *Cons.* The whole trust story of the trail is that what happened,
  happened: comments and events are immutable and nobody edits history.
  Hard delete is the biggest possible edit of history. It also silently
  destroys other people's words (comments cascade away with the ticket),
  skews the future reporting numbers (BRD F18 sells resolution counts to
  MSP clients), and hands an admin the tool to make an embarrassing miss
  disappear.
- *Recommendation.* Archive, not delete: an `archived_at` column, admin
  only, hiding the ticket from every default view behind an Archived
  filter. History stays intact, junk leaves the queue, and nothing lies.
  Hard delete stays service role only, reserved for genuine privacy
  removals, and lands in the audit log (BRD F12) when that exists.

**Submitting on behalf of someone: pros and cons.**
- *Pros.* Persona P2 lives on walk ups and phone calls; the IT person
  should be able to capture "Dana at the front desk called about the
  scanner" as Dana's ticket, so Dana can follow it.
- *Cons.* `submitted_by` is currently pinned to the session by RLS, and
  that pin is what makes the submitter claim trustworthy. Loosening it for
  admins would quietly weaken the whole visibility model.
- *Recommendation.* Do not loosen the pin. Add a separate `requested_for`
  column the admin may set: `submitted_by` stays the person who typed it
  (true), `requested_for` says who it is for, and the member policy widens
  to "tickets you submitted or tickets requested for you."

**Super admin for IT, admin for staff: pros and cons.** The schema already
reserved the ladder for this in migration 001: owner, admin, technician,
member (BRD F1). So this needs no new invention, only activation: owner is
the super tier, technician is the "IT staff who work tickets" tier, and
admin sits between.
- *Pros.* Least privilege: a technician can work every ticket without being
  able to change org membership or billing; an office manager admin can
  watch the queue without touching org settings. Accountability improves
  because the trail's actor means a narrower thing.
- *Cons.* Every table's policies grow more clauses, and the isolation suite
  grows a case for each role and verb; the permission matrix is real
  ongoing cost. A solo MSP gains nothing from four tiers (they are all four
  roles at once). And Clerk sync only maps admin and member today, so owner
  and technician need in app role management built first (clerk-sync.ts
  assigns them in app by design).
- *Recommendation.* Activate technician together with assignment (both
  answer "whose desk is this on") rather than as its own task, keep member
  exactly as simple as it is, and treat owner vs admin separation as a
  Phase 2 concern when billing (F13) gives owner something only owners
  should touch.

---

## Tickets: the follow ups parked by the Task 3 ruling

**What.** Four things the tickets feature deliberately shipped without:
email notifications on ticket activity, assignment (whose desk is this on),
priorities and categories, and the separate client portal for people outside
the org. Also parked, smaller: comment editing (comments are immutable in
this build; a wrong comment is corrected by a follow up comment).

**Why.** Task 3 scoped tickets to lifecycle, role based visibility, the
system trail, and the Get help surface. Each parked item pulls in real
design work (notifications need per org preferences and BRD F10 plumbing;
assignment wants the technician role to mean something; the portal is BRD
persona P3 with its own auth story). Capturing them here keeps the task PR
honest without losing the ideas.

**How (sketch).** Notifications ride the existing Resend/Discord work when
BRD F10 lands, triggered where ticket_events are written. Assignment is a
nullable assigned_to column plus a policy widening and a queue filter.
Priorities are a column and a sort tweak; resist building them before a real
queue is long enough to need triage. The portal reuses the Get help surface
per BRD D4, scoped to a portal role.

---

## Monitors: run the first check immediately on save

**What.** When a user adds a monitor and presses save, check the URL once right
away, instead of leaving it Pending until the next cron sweep. After that first
immediate check, the monitor falls back to its configured interval as normal.

**Why.** Today a new monitor shows Pending until the daily sweep runs (and on
the free Vercel Hobby plan that can be up to a day away), so the user gets no
confirmation that the URL they entered is even reachable. An instant first
check turns the add flow into immediate feedback: green, red, or a clear error
the moment they save. It also makes the empty to populated transition feel
alive rather than dormant.

**How (sketch).** In the create path (`src/app/dashboard/monitors/actions.ts`
→ `createMonitor` in `src/lib/db/monitors.ts`), after the row is inserted, run
one check and record it:

- Reuse `runMonitorCheck` from `src/lib/monitoring/check.ts` so the SSRF guard,
  the 10 second timeout, and the up/down logic are identical to the sweep. Do
  not fork a second checker.
- Writing the result means writing `monitor_checks` and updating
  `monitors.last_status` / `last_checked_at`, which are service role only by
  design (RLS + GRANTs). A user session cannot write them, so the immediate
  check has to go through a server side path that uses the admin client, the
  same narrow exception the cron route already uses. Keep that write in one
  place; do not widen the grants.
- The check can take up to 10 seconds. Decide whether the save waits for it
  (simpler, but the form hangs on a slow target) or the row is created first
  and the check runs right after so the redirect is instant and the result
  lands a moment later. The second reads better and matches how the cron sweep
  already separates "record the monitor" from "record a check."
- The interval logic already treats `last_checked_at = null` as due, so once
  the first check stamps that column, the existing sweep math carries the
  monitor forward on its normal interval with no special casing.

**Blocked on nothing.** This is a self contained follow up to Phase 1 Task 1;
it can land any time after the monitors feature without touching incidents.
