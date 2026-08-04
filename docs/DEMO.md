# Talvext demo script

Ten minutes, run against production at https://talvex-chi.vercel.app. Written to
be read while presenting: each beat says what you do, what you say, and what the
audience should notice.

Related: [ARCHITECTURE.md](ARCHITECTURE.md) for the diagram you may be asked to
draw afterwards, [WRITEUP.md](WRITEUP.md) for the questions this demo invites.

---

## The one timing fact that shapes everything

**A single failed check never opens an incident.** The first failure stamps
`failing_since`, and the next sweep rechecks before opening. The sweep runs
every five minutes from an external scheduler, and the minimum monitor interval
is five minutes, so from "the target dies" to "the incident is open" is **two
sweep cycles, five to ten minutes of real time**.

That is a deliberate design (it is what stops one dropped packet paging
somebody at 3am) and it does not fit inside a ten minute demo if you start the
clock when the audience arrives.

**So you pre arm the outage, and you say that you did.** Killing the target
about eight minutes before you start means the incident opens live, on cue,
during beat 5. Do not hide this. Saying "I killed this one eight minutes ago,
because confirmation takes two cycles by design, and I would rather show you
the design than fake instant detection" is a better moment than the incident
itself.

---

## Before you start

### Once, and it stays done

These are the things that cannot be done in the room. All of them exist already
on the demo org if you are using the prepared one.

1. **A demo organization with a real Clerk org behind it.** Create it in the
   app the ordinary way; never insert an `organizations` row by hand, because a
   fabricated `clerk_org_id` breaks the invariant every policy depends on (see
   [RUNBOOK.md](RUNBOOK.md) section 2).
2. **An AI provider key.** Settings, AI providers: add an Anthropic, OpenAI, or
   Google key. **Without this the chat beat does not work at all**, because
   Talvext is bring your own key and there is no platform key. This also writes
   an `api_key_added` row you can point at later.
3. **At least two published documents**, one of which plainly answers the
   question you plan to ask. The seeded set uses a label printer article; if you
   write your own, ask a question whose answer is unmistakably from the
   document and not from the model's general knowledge. Documents, New, write
   it, publish it. Leave the audience tags empty so every member can read it.
4. **Notification settings.** Settings, Notifications: a real inbox you can
   show on screen, a Discord webhook pointing at a channel you can show, alert
   on open **checked**. Press **Send a test** and confirm both arrive before
   demo day, not during it.
5. **A controllable target URL.** See the box below.
6. **Some history.** A demo org with three monitors and one ticket looks like a
   toy. The prepared org has a few weeks of checks behind it, which is what
   makes the uptime bars and the usage numbers worth showing.

### Choosing a target you can kill

The monitor's SSRF screen refuses private and internal address space, so
**you cannot point at localhost, a LAN address, or a tunnel to your laptop.**
It must be a real public URL.

The best option is a throwaway static page on a Vercel project you own, killed
by turning **deployment protection on**, which makes it answer 401 instantly and
is reversible with one click. Anything that is not a 2xx within ten seconds
counts as down, so 401 works exactly like a crash.

Two alternatives if that is inconvenient: delete a deployment (real, slower to
undo), or keep a second tiny host you can stop. What you should not do is edit
the monitor's URL to point at something already broken. It produces the same
screens, but if anyone asks what you did you will have to say you changed the
question rather than broke the answer.

### On demo day, in this order

| When | Do this |
|---|---|
| T minus 15 min | Open https://talvex-chi.vercel.app/api/ops/heartbeat. It must return 200. A 503 means the sweep is stale and **nothing in this demo will work**; see [RUNBOOK.md](RUNBOOK.md) section 1 before continuing. |
| T minus 12 min | Sign in. Confirm the Overview looks healthy and the chat answers a throwaway question. |
| T minus 8 min | **Kill the target.** Note the time. Eight minutes is chosen to be safe rather than dramatic: the scheduler's ticks are not aligned to you, so the incident lands anywhere from five to ten minutes after the kill, and you want it open by beat 5 rather than exciting. |
| T minus 5 min | Open your tabs: the dashboard, the target URL, your inbox, your Discord channel, and one private window for the status page. |
| T minus 1 min | Check the monitor list shows the killed monitor as **Down**. That means `failing_since` is stamped and the next sweep opens the incident. If it still says Up, the first sweep has not landed yet; wait for it before starting, because everything downstream depends on it. |

---

## The script

### Beat 1 — Who you are, and who you are not (0:00 to 0:45)

**Do.** Sign in. On the dashboard, open the organization switcher in the top
left.

**Say.** "Talvext is multitenant. Everything you are about to see belongs to one
organization, and the separation is not a filter in my application code, it is
row level security in Postgres. If I switch organizations, every screen changes,
because the database is answering a different question, not because the UI is
hiding things."

**Notice.** There is no personal workspace in that switcher. Every session
carries an organization, deliberately, because a session without one would
silently return zero rows everywhere and look like an empty account rather than
a bug.

*If asked about sign up:* it is Clerk with Google, and the same switcher is
where a new organization gets created. Creating one live takes fifteen seconds
if you want to show it.

### Beat 2 — The Overview, and what it refuses to say (0:45 to 1:45)

**Do.** Stay on Overview. Point at the verdict line at the top, then the four
tiles, then the monitor list with its uptime bars.

**Say.** "This is the answer to the only question the person who owns these
systems actually asks in the morning, which is whether anything is on fire."

**Notice.** The verdict at the top is computed from freshness first. If the
sweep had stopped, this line would say it does not know, rather than saying all
systems are operational from data that stopped updating. That is a real lesson:
during an outage this page cheerfully said everything was fine for hours,
because every monitor kept its last known status. A claim computed from stale
data is not a weaker claim, it is a false one.

### Beat 3 — Add a monitor, and break something (1:45 to 3:00)

**Do.** Monitors, Add monitor. Name it something the audience will recognize.
Paste the target URL. Leave the interval at five minutes, which is the minimum
and the default. Save. Then switch to
the tab with the target open, turn on deployment protection, and reload it in
front of them so they see it fail.

**Say.** "That is all it takes to start watching something. And now I break it,
in public."

Then, immediately and without being asked:

"The one I actually broke for this demo is the other monitor, about eight
minutes before we started. Talvext will not open an incident on a single failed
check. It stamps the failure, waits for the next sweep, and rechecks. One
dropped packet should not wake anybody up. That costs two sweep cycles, so the
one I just broke in front of you opens in five to ten minutes, and the one I
broke earlier is either open already or about to be. We will come back to it."

**Notice.** The new monitor shows Pending, not Up and not Down. It has not been
checked yet and the product says so rather than guessing.

### Beat 4 — The part that deflects the tickets (3:00 to 5:30)

**Do.** Documents in the sidebar, to show a couple of articles exist. Then Help,
or the Ask Talvext button, and ask the question your document answers. Wait for
the reply. Point at the reference card underneath it, then click through to the
document.

**Say.** "This is the half of the product that is not monitoring. Someone at the
front desk has a problem, and most of the time the answer is already written
down by their own IT person. The assistant answers from those documents and
shows which one it used."

**Notice, and this is the strongest technical point in the demo.** The
retrieval runs on the caller's own database session. It is not filtered
afterwards in application code. So the assistant is physically unable to quote a
document this person could not open themselves, and documents can be targeted at
some members and not others. Also worth saying out loud: this is the
organization's own key, not mine. Talvext never pays for anyone's inference and
the key is encrypted before it reaches the database.

*If the reply is slow*, that is the honest state: replies are not streamed yet,
which was a deliberate call, and it is on the future list.

### Beat 5 — The incident, live (5:30 to 7:15)

**Do.** Back to the dashboard. The pre armed incident should now be open. Open
it and walk the timeline. Then switch to your inbox and show the email, and to
Discord and show the message.

**Say.** "There it is. It opened by itself, backdated to when the thing actually
went down rather than when we noticed, and it told a human in two channels."

**Notice.** The incident is backdated to `failing_since`, not to the confirming
check, so the duration is honest. Email and Discord are on every tier including
free, permanently, because an organization that cannot be told its site is down
is not on a cheaper plan, it is on a broken product.

*Optional, if the room is technical and you have the time:* the Create ticket
button on this incident makes the linked ticket, which is the integration the
whole product exists for. It costs about twenty seconds.

### Beat 6 — The page you send to a customer (7:15 to 8:15)

**Do.** Settings, Status page. Turn it on and save, in front of them. Copy the
URL, paste it into a private window.

**Say.** "This is what the client sees, with no login at all."

**Notice.** That private window is an anonymous database session. It can read
the name, the slug, and the monitor states of organizations that opted in, and
there is no column for anything else, so there is nothing for it to reach even
if it asked. Note that the open incident from beat 5 is already on the page.

### Beat 7 — The receipt (8:15 to 9:00)

**Do.** Settings, Audit.

**Say.** "Everything sensitive that just happened is here, and it happened
sixty seconds ago."

**Notice.** The status page entry you produced in beat 6 is at the top with a
timestamp from the last minute, and the AI key entry from prep is below it. Be
precise about what is here and what is not: this log covers role changes, key
changes, status page and notification settings, documents, inventory, and
ticket lifecycle transitions. **Incidents** are not in it, because they carry
their own timeline. Neither is anything anybody wrote: the log records that a
ticket was canceled or reopened and who did it, never the comment or the
internal note that went with it. And it is append only in the database,
enforced by a trigger, so no admin and not even the service role can rewrite
it.

### Beat 8 — What it costs (9:00 to 10:00)

**Do.** Settings, Usage.

**Say.** "Messages, tokens, checks, and seats. This is what a bill would be
computed from."

**Notice, and close on the honesty.** There is no billing yet. This screen is
counters and a dashboard, not an invoice, and it is labelled that way rather
than mocked up to look finished. The same is true of the four places this build
deliberately differs from its own requirements document, all four of which are
written down in the decision log.

---

## Afterwards

1. **Turn the target back on.** The incident auto resolves on the first
   successful check, so it will close itself within a sweep or two with no
   human step. If you want to show recovery, this is the moment, but it is
   usually past the ten minutes.
2. **Delete the monitor you added in beat 3**, unless you want it opening an
   incident later tonight. Deleting it writes a `monitor_deleted` audit row,
   which is fine.
3. **Turn the status page back off** if you enabled it on an org that should not
   have one, since enabling it is what makes that organization's name and slug
   publicly listable.
4. Leave the AI key in place if the org is your standing demo org.

---

## When it goes wrong

| Symptom | What it means | What to do in the room |
|---|---|---|
| Heartbeat returns 503 before you start | The sweep is stale. No monitor will be checked and no incident will open. | Do not start. [RUNBOOK.md](RUNBOOK.md) section 1. |
| Monitor still says Pending after ten minutes | The sweep is not running, or the monitor was created just after a sweep. | Check the heartbeat. Fall back to an incident that already exists. |
| Incident never opens | The target is answering 2xx. Deployment protection can take a moment, and a cached response can look fine in your browser. | Reload the target hard. If it is 200, the product is right and the target is not dead. |
| No email arrives | `RESEND_API_KEY` or `RESEND_FROM` unset, or alert on open unchecked, or the cooldown suppressed it. | Show the Discord message instead. Both channels are configured independently on purpose. |
| Chat says it needs a key | The organization has no provider key. | You cannot recover this live. Talvext is bring your own key and there is no platform fallback. Skip to beat 6. |
| A deep link returns 404 | The live deployment runs on a Clerk development instance, where a cold deep link 404s instead of redirecting to sign in. | Navigate from the home page. It is a known cost of not owning a domain yet, and it is in the decision log. |

**If something breaks that you cannot explain, say so and move on.** The
decision log in this repository is full of things that broke in production and
what was done about them. A presenter who says "I do not know, and here is where
I would look" is making the same point the rest of the demo makes.
