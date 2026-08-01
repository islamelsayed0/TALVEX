# How Talvex is built, and why

A technical read of the decisions that shaped this codebase. The diagram is in
[ARCHITECTURE.md](ARCHITECTURE.md). Every ruling referenced here has a dated
entry in [DECISIONS.md](DECISIONS.md), usually with the alternative that was
declined.

---

## This is the third build, and it inherited its rules from the first two

Talvex merges two projects I built before it: NetPulse, uptime monitoring in
Next.js, and HelpMe Hub, a Django helpdesk. Both worked. The two strictest rules
in this repository are each a scar from one of them.

NetPulse enforced tenant separation in application code. Every query carried a
filter, and every filter was correct, right up until one was not. The lesson is
not "be careful with filters". It is that a boundary held by discipline fails
silently the first time someone forgets, and nothing tells you.

HelpMe Hub got a secret into git history. Deleting it in a later commit does
nothing, because history is the thing that leaked. So this repository has had a
gitleaks job in CI since the first week, a pre commit hook that scans staged
changes, and a test that fails the build if `.env.example` ever holds something
shaped like a real credential.

Neither rule came from a best practices list. Both came from a specific
afternoon I would rather not repeat.

---

## The database is the tenant boundary

Every table holding organization data has row level security on. Policies read
the caller's organization out of their Clerk token and filter to it. There is no
tenant filter in application code that, if forgotten, would leak.

```sql
org_id in (select id from public.organizations
           where clerk_org_id = (select public.clerk_active_org_id()))
```

Two details in there cost real thought. Clerk emits the active organization in
two claim shapes, so the helper coalesces both; dropping the coalesce would
break isolation for whichever shape went unhandled, and it would look like an
empty dashboard rather than an error. And a session with no organization
resolves to null, which matches nothing, which returns zero rows. That is worse
than a crash, because it is indistinguishable from a tenant who genuinely has no
data. The data layer therefore refuses to run any query without an organization
claim rather than letting a scoped query run unscoped.

Policies name rows. Grants name columns, and they do work policies cannot. An
admin may update `org_members.tags` and nothing else. An anonymous status page
visitor may read an organization's id, name, and slug, and no other column
exists for them. The encrypted key column is withheld from every signed in
session's select grant, so not even an org admin can read ciphertext.

---

## The role in the database beats the role in the token

Clerk issues the session and a role claim rides inside it. This codebase does
not trust that claim: `is_org_admin()` answers by reading the `org_members` row
the Clerk webhook maintains, so a stale or forged claim changes nothing.

What makes the ruling worth telling is what it caught eight migrations later.

Migration 001, written before the ruling existed, gave org admins a membership
correction path: insert a membership, update a role. Both policies were gated on
the **claim**. Read those facts together and there is a hole: the claim could
write the column that every other check in the schema trusts. A caller whose
token said admin could make the database say admin, and from that moment the
column authority agreed with them.

It was never exploited and never reachable in practice, because no application
path used those policies; the webhook on the service role has always been the
only writer. It sat as a latent contradiction, correct in 001's own terms and
wrong in the light of a ruling that arrived later.

It got cashed out when migration 014 added member tags, the first genuine
authenticated write onto that table. A real write forced a look at the write
posture, and the vestigial path was retired in the same migration: insert and
update revoked from `authenticated`, one narrow `grant update (tags)` put back.
Roles are webhook only now, and `tests/isolation/org-table-grants.test.ts`
proves an org admin attempting a role change gets `42501` with the row
unchanged.

A ruling is not finished when it is written. It has to be walked backwards
through everything that predates it, and the walk usually happens when a new
feature touches old ground.

---

## The BYOK vault, and never putting a key where it can be seen

Each organization brings its own AI provider key, which removes the margin risk
of paying for other people's inference before there is any billing. It is also
the feature with the highest cost of being wrong.

The plaintext key is encrypted with AES 256 GCM before it reaches Postgres. The
table stores ciphertext, the provider, and the last four characters for display.
GCM is authenticated, so a tampered ciphertext fails rather than decrypting to
garbage. The encryption secret lives in server environment only and never in the
database, so the database alone is not enough to recover a key.

The hygiene rule is the part I would defend hardest: **nothing key shaped is
ever logged.** Not the key, not the ciphertext, not request headers, not
provider request or response bodies. Provider errors scrub to a status based
remediation before anything reaches a log line.
`tests/chat-provider-log-scrub.test.ts` plants the key in both places a careless
implementation would leak it from, the request argument and the provider's own
error body, and asserts no fragment reaches any console channel. It also asserts
a log line was produced, so it cannot pass by logging nothing.

Rotating the encryption secret invalidates every stored key. That cost is
written down rather than discovered.

---

## A security bug I found in my own work

This is the example I would want to be asked about.

I generalized the chat rate limiter to protect two public endpoints that had
none. Self reviewing before requesting review, I read the function deciding
which caller a request belongs to. It took the **first** entry of
`x-forwarded-for`.

The leading entries of that header are whatever the client sent. A caller
putting a fresh value there on every request landed in a fresh bucket every
time. Every limit built on that function was bypassable by anyone who bothered,
including the two endpoints I was in the middle of adding. Worse, the bucket map
grew on keys of the attacker's choosing, on routes requiring no credentials,
which is memory consumption proportional to hostile traffic.

The fix prefers headers the edge sets and a client cannot forge, and falls back
to the **last** hop rather than the first. The key space is bounded too: expired
keys are pruned at a ceiling, and if every remaining key is still active the map
is cleared, briefly forgiving everyone. Forgiving is the correct direction,
because refusing legitimate callers when a limiter fills up turns a rate limit
into an outage.

Two things I take from it. The bug was in the oldest, least interesting function
in the change, not in the new endpoints I was thinking about. And the limitation
is still written down beside the fix: this limiter is in memory, so on Vercel it
is per instance and resets on cold start. It stops a runaway loop and a lazy
scanner. It is not metering, and it does not stop a distributed attack.

---

## The guard that is never merged over

Twice in two days, merged code assumed schema the live database did not have,
and both times the first symptom was a 500 in front of a user. A migration file
is a promise, nothing was checking the promise had been kept, and a reviewer
cannot see the state of a database in a diff.

So a CI job compares three sets: the migrations on the base branch, the
migrations in the checkout, and the versions the database records. Already
merged but not applied fails the build. So does a version the database records
that no file explains. It deliberately does not fail a pull request for the
migration that pull request adds, since that one has not merged and is therefore
not yet a promise.

Then it went red on me, on the first branch of a landing sequence, for a reason
I fully understood and that would have resolved itself two merges later. Two
defensible workarounds existed: merge with the check red, since it is not a
required check and GitHub would have allowed it, or reorder the landing so the
branch carrying the migration file went first, squashing two unrelated pieces of
work together.

I took a third option. A branch containing only the migration file, byte
identical to what the database had already run, merged on its own. No code read
the table yet, so the file alone was inert, and the guard went green because the
drift had genuinely ended.

The rule that came out is absolute rather than a judgement call, and that is the
point. A guard overridden once because the override was defensible is a guard
whose next override only has to be defensible too.

---

## A test that cannot fail proves nothing

The isolation suite is 358 tests against a real Postgres, applied from zero, in
both claim shapes. It never skips: without the local stack it fails with the
command that fixes it, rather than reporting green for work it did not do.

The harder discipline is making sure each guard can actually fail. Every cross
tenant probe runs against rows genuinely written first through the service role,
so an empty result means a policy filtered something real. The environment
hygiene guard was checked by planting a realistically shaped key in
`.env.example`, watching the test go red, then removing it.

The story that earned this section is smaller and more embarrassing. After
adding the pre commit secret scan I verified it by staging a fake AWS key,
`AKIAIOSFODNN7EXAMPLE`. The hook reported nothing, and for a minute it looked
broken.

It was not. That string is AWS's own documentation key, and gitleaks allowlists
it deliberately so it does not fire on every tutorial ever committed. My test key
was the one key in the world guaranteed not to trip the scanner. A realistic
token tripped it immediately, and the verification that mattered more also
passed: with gitleaks removed from the PATH entirely, the hook exits 1 and
refuses the commit rather than passing silently.

I nearly concluded a working guard was broken. The opposite mistake, where a
broken guard looks fine because the input you tested it with could never have
fired, is the one that ships. Both come from the same root, and it is why
"verified able to fail" is a rule here rather than a slogan.

---

## What this project actually is

A multitenant SaaS where the isolation claim is proven rather than asserted, and
where the interesting artifact is not the feature list but
[DECISIONS.md](DECISIONS.md). That file records what was decided, what was
rejected, and what stays knowingly unmet: no point in time recovery on a free
plan, rate limits that are per instance, a status page that permits
organization enumeration, and four places the build deliberately differs from
its own requirements document.

I would rather show a reviewer the residual risks I wrote down than a green
checklist that hides them.
