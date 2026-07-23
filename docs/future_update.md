# Talvex — Future Updates

A running list of enhancements we want but are deliberately not building yet,
so the idea is captured without pulling scope into the current task. Newest on
top. Each entry says what, why, and enough of the how that whoever picks it up
is not starting cold. Promote an item into a real task when its phase comes.

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
