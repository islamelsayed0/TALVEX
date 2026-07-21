# Business Requirements Document
## All In One IT Operations Platform (Working Name: Talvex)

**Author:** Islam Elsayed
**Date:** July 20, 2026
**Version:** 1.0 Draft
**Status:** For review

---

## 1. Executive Summary

This document defines the requirements for a new SaaS product that merges two existing applications, HelpMe Hub (Django helpdesk with AI chat, tickets, knowledge base, inventory, and Stripe billing) and NetPulse (Next.js uptime monitoring with incidents, status pages, and alerting), into a single multitenant platform.

The product is an all in one IT operations hub for small organizations: AI powered support chat, ticketing, uptime monitoring, incident management, client status pages, asset tracking, and usage metering, under one roof. A core differentiator is BYOK (bring your own key): organizations may plug in their own AI provider API key (Anthropic, OpenAI, or Google) instead of paying platform AI markup.

The product will launch under its own independent brand, not under any existing agency name. It serves three purposes in priority order:

1. **Portfolio flagship.** A production grade, multitenant SaaS that demonstrates cloud, security, billing, and AI integration skills for infrastructure, platform, and AI operations roles.
2. **Internal tooling.** A working hub the author can operate for real client work.
3. **Commercial product.** A sellable SaaS for MSPs, solo IT consultants, and small internal IT teams.

---

## 2. Problem Statement

Small IT teams and solo IT service providers currently stitch together three to five tools: UptimeRobot or Better Stack for monitoring, Zendesk or Freshdesk for tickets, Notion for documentation, a spreadsheet for assets, and a chatbot bolted on top. This creates cost sprawl (often $150 to $400 per month across tools), no shared context between monitoring and support (an outage and the tickets it causes live in different systems), and no unified client view.

Existing MSP platforms (Atera, Syncro, HaloPSA) solve this but start around $129 to $149 per technician per month, carry heavy onboarding, and lock AI features behind their own metered pricing with no option to bring your own model or key.

**Opportunity:** a lightweight, modern, affordable platform where monitoring, support, and AI live in one data model, and where AI cost is transparent because customers can bring their own key.

---

## 3. Product Naming and Brand

The product ships under a standalone name and domain, fully separate from the author's agency brand. **Chosen name: Talvex.**

### Clearance summary

Roughly twenty candidates were screened before landing on Talvex, across four naming styles: descriptive compounds (Pulsedesk, Corehub, Watchline), Arabic rooted words (Sanad, Rasid, Amin), two word English compounds (Wardline, Wardpoint, Trueline, Fixpoint), and fully invented words (Vantra, Zorvia, Talvex). Nearly every descriptive and Arabic candidate was already in active use by a real company in an adjacent or identical space, which is itself a useful finding: short, meaningful names in the IT and monitoring category are heavily picked over, so a distinctive invented word carries less collision risk than a clever descriptive one.

**Talvex** cleared with the following profile:
- No use found by any company in software, SaaS, or IT services.
- The exact word is used by three unrelated companies: a Swiss commodities trading firm, a Nigerian crude oil trading company, and a UK forestry business. Trademarks are registered by category (class), so these do not conflict with a software trademark; different market, different customers, negligible real world confusion risk.
- Phonetic note: in Spanish and Portuguese, Talvex is a near homophone of "talvez" (maybe, perhaps). Not offensive, but worth being aware of given the NYC target market. Reviewed and accepted as an acceptable tradeoff for a distinctive, ownable name.

**Runner up, kept as a fallback:** Wardpoint (ward, as in watch or guard, plus point). Fully clean in every industry checked, no collision anywhere. If Talvex hits an unexpected snag during formal trademark filing, Wardpoint is the documented second choice.

**Requirement N1:** Before any public launch, spend, or printed material, run a direct search of the USPTO trademark database (tmsearch.uspto.gov) for "Talvex" filtered to Class 9 (software) and Class 42 (SaaS and technology services), and confirm the domain is actually registrable through a registrar, not just absent from search engines. The screening in this document is a strong signal, not a substitute for that direct check.

---

## 4. Target Market and Personas

**Primary segment:** solo IT consultants and MSPs with 1 to 10 technicians serving small offices (legal, medical, dental, retail, education). This buyer manages 5 to 50 client organizations.

**Secondary segment:** internal IT teams at small organizations (schools, clinics, small firms) with 100 to 2,000 users who want a self service portal plus monitoring in one tool.

### Personas

**P1: The Solo MSP Operator.** Runs an IT services business alone or with one partner. Needs client portals, monitoring alerts before the client calls, and a professional status page per client. Price sensitive; currently paying for three separate tools or using free tiers of each.

**P2: The School or Clinic IT Specialist.** One person supporting hundreds of staff. Drowning in walk ups and emails. Wants an AI chat layer that deflects password resets and printer questions, escalating only real issues into tickets. Wants asset inventory in the same system.

**P3: The Client End User.** Non technical staff member at a served organization. Opens the portal, asks the AI a question, gets an answer or a ticket. Checks the status page during outages. Must require zero training.

---

## 5. Goals and Success Criteria

### Business goals
- G1: Platform in production, self hosted demo environment live, within 90 days of build start.
- G2: At least one real organization (internal or client) using it daily within 120 days.
- G3: First paying external customer within 6 months of launch (stretch goal).

### Career goals
- G4: The project demonstrably covers: multitenant architecture with row level security, OAuth and SSO, encrypted secrets management (BYOK vault), usage metering and Stripe billing, cron based distributed checks, AI provider abstraction, CI/CD, and observability. Each maps to a resume bullet and an interview story.
- G5: Public artifacts produced: architecture diagram, README of production quality, a short demo video, and a technical write up suitable for LinkedIn and the author's YouTube channel.

### Success metrics (post launch)
- Uptime of the platform itself: 99.5 percent or better (measured by its own monitoring, which is itself a demo feature).
- AI deflection rate: 40 percent or more of chats resolved without ticket creation.
- Time from monitor failure to ticket creation: under 90 seconds.
- Churn under 10 percent monthly once paying customers exist.

---

## 6. Scope and Feature Requirements

### 6.1 MVP (Phase 1)

| ID | Feature | Description | Source |
|---|---|---|---|
| F1 | Multitenant organizations | Orgs with roles: Owner, Admin, Technician, Member. Invitations, join requests, org switching. Row level security enforced at the database layer. | HelpMe (rebuilt) |
| F2 | Authentication | Clerk with Google sign in enabled. Organization support via Clerk Organizations. Email and password as fallback. | NetPulse (extended) |
| F3 | Uptime monitors | HTTP checks, intervals, pause, manual check, history, response time charts. | NetPulse (ported) |
| F4 | Incidents | Auto opened on failure threshold, timeline updates, resolve on recovery. | NetPulse (ported) |
| F5 | Ticketing | Tickets with status, priority, comments, internal notes, assignment. | HelpMe (rebuilt) |
| F6 | AI support chat | Org scoped chat that answers from the org knowledge base and escalates to a ticket on request or on failure to resolve. | HelpMe (rebuilt) |
| F7 | BYOK AI provider settings | Org admins add their own API key for Anthropic, OpenAI, or Google. Keys encrypted at rest, never exposed to the client, validated on save, usable immediately. Platform managed key available as the default on paid tiers. | New |
| F8 | Incident to ticket bridge | A monitor failure auto creates an incident and a linked ticket in the affected org, with alert notifications. Recovery resolves the incident and annotates the ticket. This is the signature integration of the merged product. | New |
| F9 | Status pages | Public per org status page with uptime heatmap and incident history. | NetPulse (ported) |
| F10 | Notifications | Email (Resend) and Discord webhook included on every tier, including Free; this is how a customer finds out their site is down and must never be gated. Slack integration is a paid tier feature (signals a team, business buyer). Per org configuration and thresholds. | NetPulse (extended) |
| F11 | Usage metering | Per org counters: AI messages and tokens, monitor checks executed, seats, storage. Rollup jobs feed both the billing engine and an admin usage dashboard. | New |
| F12 | Audit log | Immutable log of sensitive actions (role changes, key changes, deletions, billing events). | HelpMe (rebuilt) |

### 6.2 Phase 2

| ID | Feature | Description |
|---|---|---|
| F13 | Stripe billing | Subscription tiers, seat counts, metered AI overage, customer portal, webhook driven entitlement. |
| F14 | Knowledge base | Org scoped articles with categories; the AI chat retrieves from these articles (retrieval augmented answers). |
| F15 | Asset inventory | Devices and licenses per org: type, assignee, warranty, notes, CSV import and export. |
| F16 | Email to ticket | Inbound email address per org that creates tickets (via Resend inbound or a parsing service). |
| F17 | Scheduled maintenance | Planned maintenance windows displayed on status pages and suppressing alerts. |
| F18 | Reporting | Monthly per org report: uptime, ticket volume, resolution time, AI deflection, exportable as PDF. Directly monetizable for MSP client reviews. |

### 6.3 Phase 3 (Later)

| ID | Feature | Description |
|---|---|---|
| F19 | White labeling | Custom domain and logo on status pages and portal for MSP resale. |
| F20 | Public API and webhooks | Token authenticated REST API; outbound webhooks on ticket and incident events. |
| F21 | SLA policies | Response and resolution targets per org with breach alerts. |
| F22 | CSAT surveys | Post resolution rating prompt; scores in reporting. |
| F23 | Cloud spend visibility | Admin (platform operator) dashboard pulling Vercel and Supabase usage APIs to show cost per tenant and gross margin. Optionally, customer facing AWS or GCP cost widgets much later. |
| F24 | Mobile PWA | Installable progressive web app for technicians with push notifications. |

### 6.4 Out of Scope

- Remote monitoring and management agents installed on endpoints (full RMM). This is a multi year effort and a different security posture. The platform monitors services over the network only.
- Native mobile apps (PWA covers the need).
- On premise self hosted distribution at launch (revisit if demand appears).
- Any integration with the author's separate internal agency systems. Not part of this product's scope or roadmap.

---

## 7. BYOK: Analysis and Requirements

### Why BYOK

AI cost is the scariest line item for a SaaS operator and the most opaque one for a buyer. Letting organizations bring their own key converts a variable platform cost into a customer controlled cost, and it is a genuine trust signal: the customer sees exactly what AI usage costs because the bill comes from their own provider account.

### Pros
- **Removes AI margin risk.** A heavy chat user on a BYOK plan costs the platform nearly nothing in inference.
- **Sales differentiator.** No mainstream competitor at this price point offers provider choice plus key ownership.
- **Compliance appeal.** Medical and legal offices may already have data processing agreements with a specific AI vendor; BYOK lets them stay inside that agreement.
- **Model flexibility.** Customers pick the model quality and cost point they want.
- **Portfolio value.** Building a provider abstraction layer plus an encrypted key vault is exactly the kind of system design interviewers ask about.

### Cons
- **Support burden.** "The AI stopped working" may mean the customer's key expired, hit a rate limit, or ran out of credit. The platform gets blamed for provider problems.
- **Inconsistent quality.** A customer on a cheap model will have worse AI answers and may judge the product for it.
- **Security surface.** Storing third party API keys makes the platform a higher value target. Encryption, access controls, and audit become mandatory, not optional.
- **Prompt portability.** Prompts tuned for one model behave differently on another; the abstraction layer needs per provider prompt adjustments and testing.

### Tradeoff decision
Offer both, and make the default the easy path:

- **Managed AI (default on paid tiers):** the platform key is used, usage is metered, and a fair monthly allowance is included with overage billing. Zero setup friction.
- **BYOK (available on all paid tiers):** the org key is used, allowance limits are removed, and the plan price is discounted (see pricing). Clear in product messaging that provider errors surface as provider errors.

### BYOK requirements
- B1: Supported providers at launch: Anthropic, OpenAI, Google. One active provider per org.
- B2: Keys encrypted at rest with an application level encryption key held only in server environment secrets. Keys never returned to any client after save; UI shows last four characters only.
- B3: Key validated with a minimal test call on save; clear error surfaced if invalid.
- B4: All AI calls made server side only. Keys never enter browser bundles, logs, or error traces.
- B5: Provider errors (401, 429, quota) surfaced to org admins with plain language remediation ("Your OpenAI key was rejected. Check billing on your OpenAI account.").
- B6: Key rotation and deletion available to org owners; both are audit logged.
- B7: A provider abstraction layer normalizes chat requests and responses across providers, with per provider prompt templates.

---

## 8. Competitive Gap Analysis (What Is Missing and Why It Matters)

Compared against Atera, Syncro, Zendesk, Freshdesk, UptimeRobot, and Better Stack, the merged codebase is missing the following. Items marked with a phase are planned; items marked Deferred are consciously excluded.

| Gap | Competitors that have it | Plan |
|---|---|---|
| Email to ticket | Zendesk, Freshdesk, HaloPSA | Phase 2 (F16). Table stakes for helpdesk buyers. |
| SLA tracking | Zendesk, HaloPSA, Atera | Phase 3 (F21). |
| Client reports | Atera, Syncro | Phase 2 (F18). High value for MSP retention conversations. |
| Maintenance windows | Better Stack, UptimeRobot | Phase 2 (F17). Cheap to build, expected on status pages. |
| White label status pages | Better Stack, Atera | Phase 3 (F19). |
| CSAT | Zendesk, Freshdesk | Phase 3 (F22). |
| Public API | All major players | Phase 3 (F20). |
| RMM device agents | Atera, Syncro, NinjaOne | Deferred indefinitely. Out of scope; the product competes as network level monitoring plus helpdesk, not endpoint management. |
| Phone or SMS alerting | Better Stack, PagerDuty | Deferred. Telegram and Discord cover the target segment; Twilio adds cost and compliance work. |
| Marketplace integrations (Slack, Teams, QuickBooks) | All major players | Deferred to post revenue. Webhooks (F20) are the bridge. |

---

## 9. Pricing Model

Positioning: dramatically under MSP suites, slightly above pure uptime tools, justified by consolidation.

| | Free | Starter $29/mo | Pro $79/mo | Agency $149/mo |
|---|---|---|---|---|
| Organizations (client workspaces) | 1 | 3 | 10 | Unlimited |
| Team seats | 2 | 5 | 15 | Unlimited |
| Monitors | 5 | 25 | 100 | 300 |
| Check interval | 5 min | 1 min | 30 sec | 30 sec |
| AI messages included (managed key) | 50/mo | 500/mo | 2,500/mo | 10,000/mo |
| BYOK | No | Yes ($5/mo discount) | Yes ($10/mo discount) | Yes ($15/mo discount) |
| Status pages | 1 | Per org | Per org | White label (Phase 3) |
| Alerts: Email + Discord | Yes | Yes | Yes | Yes |
| Alerts: Slack | No | No | Yes | Yes |
| Email to ticket | No | Yes | Yes | Yes |
| Reports | No | No | Yes | Yes |
| API access | No | No | Yes | Yes |

Pricing principles:
- P1: The Free tier is a real product for one org, sized so a solo user can live on it. It is the top of the funnel and the demo for job interviews.
- P2: AI overage on managed keys billed per 100 messages at a rate at least 3x the underlying model cost, keeping margin positive.
- P3: BYOK discount is deliberately modest. The value of BYOK is control and unlimited usage, not a cheaper subscription.
- P4: Annual billing at 2 months free.
- P5: Prices are hypotheses. Validate against 5 to 10 buyer conversations before locking.
- P6: Email and Discord alerts are never gated behind a paid tier, on any plan, including Free. These are how a customer finds out their site is down; a free user hearing nothing during an outage is the worst possible first impression and directly undermines the product's core promise. Capacity is gated instead (monitor count, check interval, seats), never the alert itself. Slack is gated because it signals a team or business buyer who expects to pay, not because the alert matters less.

### 9.1 What This Actually Costs To Build and Run

At MVP stage, every tool in this document has a free tier sufficient for development, testing, and a real demo:

| Service | Free tier limit | When it starts costing money |
|---|---|---|
| Vercel | Unlimited for personal, non commercial use | Pro plan (~$20/mo) required the moment the product is used commercially or a customer pays |
| Supabase | Free project, pauses after inactivity | Paid tier when the database needs to stay always on at scale |
| Clerk | Free up to several thousand monthly active users | Priced per MAU beyond that threshold, far off at launch |
| Resend (email) | Roughly 3,000 emails/mo free | Paid tier only at meaningful send volume |
| GitHub Actions | Free on public repos; 2,000 free minutes/mo on private repos | Additional minutes billed beyond the free allotment |
| Domain | $0 (use the free `*.vercel.app` subdomain) | ~$12/yr once a custom domain is worth buying |

**Bottom line: $0 to build, test, and demo the entire MVP.** The first real cost is a domain (~$12/yr) once there is a reason to look professional to a paying stranger, and the first recurring cost is Vercel Pro (~$20/mo) the day the product is used commercially or a customer starts paying. Exact limits shift over time; verify current thresholds on each provider's pricing page before launch.

---

## 10. Key Tradeoff Decisions

| Decision | Options considered | Choice and rationale |
|---|---|---|
| Auth | Clerk vs Supabase Auth vs self built | **Clerk with Google SSO.** Clerk Organizations gives multitenancy primitives (orgs, invitations, roles) out of the box, cutting weeks of work HelpMe spent building by hand. Cost is acceptable at this scale. Revisit only if MAU pricing bites. |
| Database | Supabase vs raw Postgres (RDS) vs PlanetScale | **Supabase.** Row level security is the backbone of tenant isolation and a strong interview topic. Existing NetPulse migrations carry over. |
| Hosting | Vercel vs Railway vs Fly.io | **Vercel.** Railway is retired. Vercel fits Next.js natively; cron endpoints keep the external scheduler pattern already proven in NetPulse. |
| Architecture | One Next.js app vs separate frontend and API service | **Single Next.js app** (App Router, server actions and route handlers). One deploy, one repo, fastest iteration for a solo builder. Extract a worker service later only if check volume demands it. |
| Framework consolidation | Keep Django alongside vs full port | **Full port to TypeScript.** Two runtimes doubles hosting, auth glue, and maintenance. Django features are rebuilt on Supabase; the Django repo remains as design reference. |
| AI default | BYOK only vs managed only vs both | **Both** (Section 7). BYOK only kills onboarding conversion; managed only kills the differentiator. |
| Payments | Stripe vs Paddle vs LemonSqueezy | **Stripe.** Prior webhook code exists in HelpMe and Stripe experience is directly resume relevant. Note: as merchant of record alternatives, Paddle simplifies sales tax later; revisit at meaningful revenue. |
| UI system | Hand rolled vs shadcn refresh | **shadcn base restyled with a distinctive design pass** so the product does not look like default template output. See Section 11. |

---

## 11. Design Requirements

- D1: The UI must not read as generic AI generated dashboard output. A deliberate design pass is required: distinctive typography, a defined color system, real information hierarchy, and consistent component styling across marketing site, portal, and status pages.
- D2: Status pages are the most publicly visible surface and receive the highest design polish; they are effectively marketing.
- D3: Dark and light themes at launch (dark mode already exists conceptually in HelpMe).
- D4: The client end user portal (Persona P3) is optimized for zero training: one primary action (ask for help), one status indicator.
- D5: Accessibility: WCAG 2.1 AA contrast targets on all text and interactive elements.

---

## 12. Non Functional Requirements

- S1: Tenant isolation enforced by database row level security, not only application code. Automated tests must prove cross tenant reads fail.
- S2: Secrets hygiene: no secrets in the repository, pre commit secret scanning enabled from the first commit, server only environment variables never prefixed for client exposure. (Motivated by a prior credential exposure incident on the predecessor project.)
- S3: BYOK keys encrypted at rest (Section 7, B2) and excluded from all logging.
- S4: Rate limiting on public endpoints (chat, status pages, check trigger endpoint).
- S5: The platform monitors itself with its own monitors and publishes its own status page (credibility feature and permanent demo).
- S6: Backups: Supabase point in time recovery enabled; restore procedure documented and tested once.
- S7: Observability: structured logs, error tracking (Sentry), and an internal metrics dashboard for the operator.
- S8: CI: lint, typecheck, tests, and secret scan on every pull request; preview deployments per branch.

---

## 13. Career Positioning Requirements

The build must intentionally produce interview ammunition. Each item below is a deliverable, not a side effect.

- C1: **Architecture diagram** (one page) showing tenancy, RLS, the AI provider abstraction, the check scheduler, and the billing/metering flow.
- C2: **Resume bullets** the project must be able to truthfully support, for example: designed multitenant SaaS with Postgres row level security isolating N organizations; built an encrypted BYOK credential vault supporting three AI providers behind a unified abstraction; implemented usage metering and Stripe subscription billing with webhook driven entitlements; operated production monitoring with sub 90 second failure to ticket automation.
- C3: **Demo script** (5 minutes): create org, add monitor, kill the target, watch incident auto open, ticket auto create, alert fire in Telegram, resolve, show it on the status page. This single flow demonstrates the whole system and is rehearsed for interviews.
- C4: **Write up and video**: one technical article (tenancy and BYOK design) and one walkthrough video for the author's channel.
- C5: The live Free tier deployment doubles as the portfolio link on the resume, replacing or joining the two predecessor project links.

---

## 14. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Scope creep stalls launch | High | High | Phase gates are hard: nothing from Phase 2 starts until every MVP feature (F1 to F12) is shipped and demoed. |
| Build competes with job search and client acquisition time | High | High | Timebox the MVP to a fixed weekly budget; the demo (C3) is the definition of done, not perfection. |
| BYOK key breach | Low | Severe | S2, S3, B2 controls; keys segregated; audit logging; documented incident response. |
| AI answer quality damages trust | Medium | Medium | Retrieval from the org knowledge base (F14) prioritized early in Phase 2; conservative escalation defaults (escalate rather than guess). |
| Check scheduler reliability at scale | Medium | Medium | Keep external cron trigger pattern; add jittered batching; extract a worker only when volume requires it. |
| Pricing wrong | Medium | Low | P5: treat pricing as a hypothesis; adjust after real buyer conversations. |
| Vendor lock (Clerk, Vercel, Supabase) | Low | Medium | All data in standard Postgres; auth user IDs stored locally; migration path documented. |

---

## 15. Roadmap Summary

| Phase | Duration target | Exit criteria |
|---|---|---|
| Phase 0: Foundation | 2 weeks | Repo, CI, secret scanning, Clerk orgs, Supabase schema with RLS, design system pass applied to shell. |
| Phase 1: MVP (F1 to F12) | 6 to 8 weeks | The C3 demo flow works end to end in production; platform monitors itself. |
| Phase 2 (F13 to F18) | 6 weeks | Billing live, email to ticket live, first monthly client report generated. |
| Phase 3 (F19 to F24) | Ongoing | Driven by real user demand and revenue signals. |

---

## 16. Open Questions

1. Final product name and domain (Section 3).
2. Managed AI default model and the exact included message allowances per tier.
3. Whether the Free tier includes the AI chat at all, or only monitoring plus tickets (conversion lever either way).
4. Telegram alerting: shared platform bot vs per org bot token (shared bot is simpler; per org is more private).
5. Whether status pages need custom domains at Phase 2 instead of Phase 3 (MSP buyers may demand it early).

---

*End of document.*
