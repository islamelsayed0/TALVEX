# Talvex — Future Updates

A running list of enhancements we want but are deliberately not building yet,
so the idea is captured without pulling scope into the current task. Newest on
top. Each entry says what, why, and enough of the how that whoever picks it up
is not starting cold. Promote an item into a real task when its phase comes.

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
