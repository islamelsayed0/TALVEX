# Handoff: Talvex IT Operations App (Dashboard + End-user Help)

## Overview
Talvex is an all-in-one IT operations platform (uptime monitoring, incidents, tickets, AI support chat) used by small offices, solo IT people, MSPs and consultants.

This handoff covers **two personas in one product**:

1. **Admin / technician** (the IT person) — full operations dashboard: Overview, Monitors, Incidents, Tickets, Settings, plus access to the end-user Help experience.
2. **Member / office staff** (the non-technical end user) — a much smaller Help app: Help home, AI support chat, submit a request, my requests, personal settings.

The core design goal of the admin Overview: **in five seconds the IT person should know — is anything down, is anything on fire, what needs me today.**

## About the Design Files
The files in this bundle are **design references created in HTML** — prototypes showing intended look and behavior. **They are not production code to copy directly.**

The task is to **recreate these designs in the Talvex codebase's existing environment** (Next.js App Router + TypeScript + Tailwind + shadcn/ui + Clerk + Supabase), using its established patterns. Do not port the inline styles or the prototype's component runtime.

The prototypes are single-file HTML components with inline styles and a small logic class. They exist to communicate layout, hierarchy, copy, states and behavior — nothing more.

## Fidelity
**Mid-to-high fidelity.** Layout, hierarchy, spacing, copy, states and interaction model are intentional and should be followed closely. Exact pixel values are given below and are real (extracted from the prototypes), but they were authored to match the **existing token values already in `src/app/globals.css`** — so implement with those tokens, not hardcoded hex.

Two visual variants are included; **`Talvex Dashboard Flat.dc.html` is the chosen direction.**

| File | Variant | Status |
| --- | --- | --- |
| `Talvex Dashboard Flat.dc.html` | Flat: solid near-black cards, hairline borders. Chrome (nav pill, AI button) keeps glass. | **Build this one** |
| `Talvex Dashboard.dc.html` | Glass: translucent + blurred cards with gradient edges. | Reference / alternate |
| `Talvex Help.dc.html` | End-user Help app, imported by both dashboards for the member view. | Build |

Reason for choosing Flat: universal glass on every surface started to read as templated, and it required new utilities. Flat is `bg-card` + `border` you already have, and it lets the near-black surface do the work.

---

## Design System (locked — do not deviate)

These rules are **binding**. They were the constraint the design was built under.

- **Dark mode (near black) is the only mode.** Light mode was removed and the product ships dark only: `data-theme="dark"` is hardcoded, there is no toggle, and the `:root` tokens are the single palette. See `docs/DECISIONS.md` (2026-07-25), which supersedes the earlier "light stays in scope" note.
- **One friendly blue accent: `#3d8bff`.** Used *only* for actions and interactive affordances (primary buttons, links, the AI entry point, in-progress ticket state).
- **Green / amber / red are reserved exclusively for status meaning.** Never decorative.
- **Geist** for all UI text; **Geist Mono** for hostnames, timestamps, latency, uptime percentages, masked keys.
- **Calm, clean, zero template-AI aesthetic.** No gradient wallpaper, no emoji, no decorative charts, no rounded-card-with-left-border-accent.
- **Data only where it means something.** Every number, bar and sparkline on screen is real signal; nothing is filler.
- Density: **calm, not cramped.**

### Design Tokens

All of these already exist in `src/app/globals.css` — use the token, not the hex.

**Color — surfaces**
| Role | Value | Notes |
| --- | --- | --- |
| App background | `#0b0a08` | Base near-black |
| Background gradient | `radial-gradient(130% 100% at 50% -8%, #17140f 0%, #0d0b09 55%, #0b0a08 100%)` | Fixed, full-viewport, very subtle |
| Accent bloom | `radial-gradient(46% 30% at 50% 2%, rgba(61,139,255,.07), transparent 70%)` | Fixed overlay, barely perceptible |
| Noise overlay | fractal-noise SVG at `opacity: .04` | Optional; kills banding on large dark areas |
| Card (flat variant) | `#151310` | The card surface |
| Card border | `rgba(255,255,255,.07)` | Hairline |
| Card shadow | `inset 0 1px 1px rgba(255,255,255,.06), 0 14px 34px -20px rgba(0,0,0,.5)` | Soft; deliberately shallow |
| Nested tile | `rgba(255,255,255,.02–.03)` + `1px solid rgba(255,255,255,.06–.07)` | Tiles inside a card |
| Divider | `1px solid rgba(255,255,255,.06)` | Row separators |
| Input / field | `#141210` + `1px solid rgba(255,255,255,.1)` | |

**Color — text**
| Role | Value |
| --- | --- |
| Primary | `#f6f4f0` |
| Strong secondary | `#eeece7` |
| Secondary | `#d7d3cc` |
| Muted | `#a7a39c` |
| Quiet / meta | `#837e77` |
| Chip text | `#c9c3ba` |

**Color — accent & status**
| Role | Value | Usage |
| --- | --- | --- |
| Accent (actions) | `#3d8bff` | Primary button fill |
| Accent (text/links) | `#4d97ff` | Links, "View all", AI label |
| Accent gradient | `linear-gradient(150deg, #4d95ff, #2f6fd6)` | Avatars, org mark, icon tiles |
| On-accent text | `#08111f` | Text/icons on a blue fill |
| Status: up / resolved | `#4ade80` | |
| Status: down | `#f87171` | |
| Status: pending / open | `#fbbf24` | |
| Status: paused / closed | `#837e77` | |
| Status wash | `rgba(74,222,128,.12)`, `rgba(248,113,113,.12)`, `rgba(61,139,255,.09–.12)` | Icon/chip backgrounds |

**Typography** — `Geist` (400/500/600/700), `Geist Mono` (400/500)
| Role | Spec |
| --- | --- |
| Wordmark | 600 20px, `letter-spacing: -.022em` |
| Page title (h1) | 600 24px, `-.02em` |
| Verdict headline | 600 20px, `-.015em` |
| KPI number | 600 32px, `-.02em`, `line-height: 1` |
| Section heading (h2) | 600 16px |
| Card title | 600 16–18px, `-.01em` |
| Body | 400 14–14.5px, `line-height: 1.55` |
| Row primary | 500 14–14.5px |
| Meta / secondary | 400 12.5–13px |
| Quiet meta | 400 12px |
| Column header | 500 11px, `letter-spacing: .05em`, `text-transform: uppercase` |
| Section label | 600 11px, `.06em`, uppercase |
| Chip | 500 10.5px |
| Mono | 400/500 12–13px `Geist Mono` |

Minimum body size on screen: **12px** (meta only). Never smaller.

**Spacing** — 4px base. Common: `2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 14, 16, 18, 20, 22, 24, 30, 32`.
- Page padding: `30px 32px 72px`, `max-width: 1360px`, centered
- Header padding: `14px 22px`
- Card padding: `18–22px` (x), `18–20px` (y)
- Table row padding: `13px 22px` (comfortable) / `8px` (compact)
- Gap between cards: `16–20px`
- Grid gutter: `14–18px`

**Radius** — `999px` pills/dots · `20px` cards · `18px` KPI cards · `16px` tiles · `14px` icon tiles · `12px` buttons/inputs · `11px` small controls · `9px` nav items · `8px` mini tiles

**Motion** — `fadeUp .5s ease both` on main content mount · `pulseDot 1.8s ease-in-out infinite` on down-status dots only · `transition: .16s ease` on hover for color/background

**Glass recipe** (chrome only in the Flat variant — nav pill, AI button, floating pill):
```
background: rgba(255,255,255,.025–.035);
backdrop-filter: blur(9–14px);
box-shadow: inset 0 1px 1px rgba(255,255,255,.08–.1);
/* gradient hairline edge via ::before with mask-composite: exclude */
background: linear-gradient(180deg, rgba(255,255,255,.3) 0%, rgba(255,255,255,.06) 40%,
            rgba(255,255,255,0) 60%, rgba(255,255,255,.16) 100%);
padding: 1.2–1.3px;
```

---

## App Shell

### Header (admin only)
Full-width bar, `padding: 14px 22px`, `border-bottom: 1px solid rgba(255,255,255,.09)`. Three groups, `justify-content: space-between`:

**Left** — `Talvex` wordmark (600 20px). *No logo mark* — it was deliberately removed.

**Center** — glass nav pill: `display: flex`, `gap: 2px`, `padding: 4px`, `border-radius: 999px`, glass recipe + gradient edge. Items: **Overview · Monitors · Incidents · Tickets · Help**. Each `padding: 7px 15px`, `border-radius: 999px`, 500 13.5px. Active item: `background: rgba(255,255,255,.08)`, `box-shadow: inset 0 1px 1px rgba(255,255,255,.12)`, `color: #f6f4f0`. Inactive: `#a7a39c`, hover → `rgba(255,255,255,.05)` + `#f6f4f0`.

**Right** — in order:
1. **Organization pill** (glass): `18px` gradient square mark + org name (500 13.5px `#eeece7`) + `⌄`. This is the org switcher. It sits here, in the position where a "Get help" link used to be.
2. **AI button** (accent glass): sparkle icon + label `AI`, `padding: 8px 15px`, `border-radius: 999px`, `background: rgba(61,139,255,.09)`, hover `.16`, accent gradient edge, text `#4d97ff` 600 13.5px. Opens AI chat.
3. **Settings gear** — 36px circle icon button, `border: 1px solid rgba(255,255,255,.12)`, `background: rgba(255,255,255,.05)`, hover `.09`. Active (on Settings) `.1`. `aria-label="Settings"`. Icon only — no "Settings" text label.
4. **Light-mode toggle** — 36px circle icon button, moon icon, same treatment. Currently decorative.
5. **User avatar** — 34px circle, accent gradient, initials in `#08111f` 600 13px.

Header must not wrap or overlap down to ~924px: left/right groups `flex: none`, nav `white-space: nowrap`, org name `text-overflow: ellipsis`.

### Floating AI pill (admin, all screens except Help)
`position: fixed; right: 26px; bottom: 26px; z-index: 60`. Accent-glass pill reading **Ask Talvex**. Opens the Help/chat experience.

### Back-to-dashboard (admin viewing Help)
`position: fixed; left: 22px; bottom: 22px; z-index: 70`. Pill, chevron-left + **Back to dashboard**, `background: rgba(20,18,16,.82)` + blur, `border: 1px solid rgba(255,255,255,.16)`.

---

## Screens — Admin

### 1. Overview (`/dashboard`)
**Purpose:** five-second triage.

Layout, top to bottom:

**a. Greeting row** — `Good {morning|afternoon|evening}, {firstName}` (600 24px) with `{Weekday, Month D} · Updated just now` beneath (400 14.5px `#837e77`). Right side: a segmented control (`Needs attention` / `All clear`) — **prototype-only scenario switcher**; do not ship. Replace with real data.

**b. Verdict banner** — the answer to "is anything on fire". Flat card, `padding: 20px 24px`, `display: flex`, `gap: 20px`.
- 48px `border-radius: 14px` icon tile, background = status wash. Alert-triangle in `#f87171` when down; check in `#4ade80` when clear.
- Title 600 20px + subtitle 400 14.5px `#a7a39c`, `text-wrap: pretty`.
- When down: primary button **View incidents** (`background: #3d8bff`, text `#08111f`, `border-radius: 12px`, `padding: 12px 20px`, 600 14px).
- Copy, down state: *"Two systems are down"* / *"Booking API and VPN Gateway need attention. 2 incidents and 6 tickets are open."*
- Copy, clear state: *"All systems are operational"* / *"10 monitors up. No open incidents. 2 tickets are waiting on you."*

**c. KPI strip** — `grid-template-columns: repeat(4, 1fr)`, `gap: 16px`. Each card `padding: 18px 20px`, `border-radius: 18px`: label (500 13px `#837e77`), value (600 32px, colored by meaning) + unit (500 14px `#837e77`), optional visual, sub-line (400 12.5px `#837e77`).
1. **Monitors** — `2 down` (`#f87171`) / `9 up` (`#4ade80`); sub `7 up · 1 paused`
2. **Open incidents** — `2` (`#f87171`) or `0` (`#f6f4f0`); sub `oldest opened 14m ago`
3. **Open tickets** — `6`; sub `2 in progress`
4. **Avg response** — `412 ms`; sub `up 38% since yesterday`; **12-point area sparkline**, 40px tall, stroke `#a7a39c` 1.5px, fill fades `rgba(#a7a39c,.22)` → transparent. This is the latency signal the IT person needs.

**d. Two-column body** — `grid-template-columns: minmax(0,1.9fr) minmax(320px,1fr)`, `gap: 20px`.

**Left — Monitors panel.** Header: `Monitors` (600 16px) + `{n} up · {n} down · {n} total` (400 12.5px) + `View all` link (`#4d97ff`).
Column headers then rows in a **fixed-height scroll area (`max-height: 296px; overflow-y: auto`)** — shows ~4–5 monitors, scrolls to the rest. This was tuned repeatedly; keep the panel compact so it doesn't tower over the right column.
Row grid: `minmax(108px,1fr) minmax(96px,132px) 74px 68px 52px`, `gap: 8px`, `padding: 13px 18px`, top divider.
- **Monitor**: name (500 14.5px, ellipsis) + `{host} · {lastChecked}` (mono 12px `#837e77`, ellipsis)
- **Recent**: 40-bar uptime strip (see Components)
- **Status**: 8px dot (pulse if down) + label in status color
- **Response**: mono 13px, `—` when down/paused
- **Uptime**: mono 13px `#a7a39c`

**Right column** (`gap: 20px`):

**Open incidents card.** Header `Open incidents` + count chip (status-colored wash). Each incident:
- Monitor name (500 14.5px) + optional **recurrence chip** (`3rd time this month`, 500 10.5px, `rgba(255,255,255,.06)` pill)
- `Down {14m}` right-aligned, mono 13px `#f87171`
- Note (400 13px `#a7a39c`, `text-wrap: pretty`)
- **Scope** line: `Affects ~8 people · Front desk, Booking` (400 12px `#a7a39c`) — tells them blast radius
- Host (mono 12px `#837e77`)
- **SLA bar**: label `10m to SLA breach` + 6px track `rgba(255,255,255,.08)`, fill `rgba(255,255,255,.42)` at `{sla}%`. Neutral on purpose — not another red.
- **Last fix** line: repeat icon + `Last fix: Restarted the booking worker · Jul 9` + **Runbook** link (`#4d97ff`)
- Footer row: owner (22px avatar + name) **or** `Assign to me` (accent pill); plus `Notify` → becomes `Team notified` once sent; plus `Acknowledge`
- **Empty state**: 38px green-wash circle + check, `No open incidents`, `Nothing needs you right now.`, then `Last incident 6 days ago · Next maintenance Sun 2:00 AM`

**Ticket queue card.** Header + `View all`. Three tiles (`repeat(3,1fr)`, `gap: 10px`): **Open** (`#fbbf24`), **In progress** (`#4d97ff`), **Resolved today** (`#4ade80`) — 600 22px number + 400 12px label. Then ticket rows: title (500 14px, ellipsis) + meta (`from incident · 4m ago`) and a right-side status dot + label.

**Activity card.** `Activity` heading, then rows: 8px status-colored dot + text (400 13px `#d7d3cc`) + relative time (mono 12px, right). Examples: `Ticket #482 opened from the Booking API incident` (blue), `VPN Gateway went down` (red), `File Server recovered after 4m` (green), `Payments Webhook latency spiked to 512 ms` (grey).

### 2. Monitors (`/dashboard/monitors`)
Title `Monitors` + `{n} up · {n} down · {n} paused · updated just now`. Right: primary **Add monitor** button (plus icon).

One flat card, full-width table. Grid: `minmax(0,1fr) 200px 148px 88px 96px`, `gap: 14px`, header `padding: 14px 22px`, rows `13px 22px`.
Columns: **Monitor** (status dot + name + `{host} · {last}`) · **Recent checks** (40-bar strip) · **Response** (status label in status color + ` · 412 ms` in mono `#a7a39c`) · **Uptime** · **Interval** (`every 1 min`).

10 monitors in the reference data: Booking API (down), VPN Gateway (down), Patient Portal, Payments Webhook, File Server, Print Server, Email Server, Company Website, Status Page, Backup Job (paused).

### 3. Incidents (`/dashboard/incidents`)
Title `Incidents` + `2 open · 3 resolved this week`.

**Open** section label, then incident cards in `repeat(auto-fill, minmax(340px,1fr))`, `gap: 18px` — same anatomy as the Overview incident item but roomier (`padding: 20px 22px`, title 600 16px).

**Resolved this week** section label, then a flat card list: green dot + monitor name + cause (`Brief network blip, recovered on its own`) and right-aligned `Resolved in 4m` (`#4ade80` mono 13px) over the date (mono 12px `#837e77`).

### 4. Tickets (`/dashboard/tickets`)
Title `Tickets` + `{open} open · {inProgress} in progress`. Right: primary **New ticket** button.

Four count tiles (`repeat(4,1fr)`, `gap: 14px`, `border-radius: 16px`): Open (amber), In progress (blue), Resolved today (green), Closed (grey) — 600 24px + 400 12.5px label.

Table card. Grid: `minmax(0,1fr) 150px 140px 118px`, `gap: 14px`, rows `14px 22px`.
- **Ticket**: title (500 14px) + `{description} · {age}` (400 12px `#837e77`)
- **Source**: `From incident` / `From chat` / `Manual`, plus a linked-incident chip `↳ Booking API` when present
- **Assignee**: 24px initials avatar + name, or `Unassigned`
- **Status**: dot + label in status color

### 5. Settings (`/dashboard/settings`)
Title + `Manage your workspace, team and integrations.` Single column, `max-width: 780px`, `gap: 18px`.

1. **Organization** — Name (in a field-styled box), Plan (`Team · 12 monitors`), Region (`US East`)
2. **Team members** — heading + outlined **Invite** button; rows of 32px avatar + name + mono email + role (`Owner` / `Technician` / `Member`)
3. **Notifications** — Email alerts (on), SMS for down alerts (on, `Critical incidents only`), Slack (off, `Not connected`); then **Quiet hours** `10:00 PM – 7:00 AM` with `Only critical alerts wake you`. Toggle: 40×23px pill, on = `#3d8bff` with an 18px `#08111f` knob right; off = `rgba(255,255,255,.12)` with `#837e77` knob left.
4. **AI providers** — `Bring your own key. Keys are stored encrypted and never leave the server.` Rows: status dot + provider + `key ••••4f2a` or `Not connected`, with **Manage** / **Connect** link. Anthropic connected; OpenAI and Google not.

---

## Screens — End user (Help app)

Same glass shell, **fewer nav items**. Member nav: **Home · My requests** (plus AI and personal settings). Members must never see Monitors, Incidents, admin Tickets, or org Settings.

1. **Help home** — search field, prominent **Ask AI** entry, **New request** action, and a short list of the user's recent requests.
2. **AI support chat** — conversational thread with an **escalate to ticket** affordance. Language stays non-technical.
3. **Submit a request** — simple form (what's wrong, where, urgency). Plain-language labels, no jargon, no severity taxonomy.
4. **My requests** — the user's own tickets only, with human-readable status.
5. **Personal settings** — name, email, notification preferences. No org or infrastructure settings.

Tone throughout: calm, plain English, reassuring. This persona does not know what a monitor or an SLA is.

---

## Interactions & Behavior

- **Nav** switches screens and scrolls to top. Active state is driven by current route.
- **Gear** → Settings; active state reflected in its background.
- **AI button / floating "Ask Talvex" pill** → AI chat.
- **Admin → Help**: the `Help` nav item renders the end-user experience inside the admin shell, with a fixed **Back to dashboard** button. Implement as a route (`/dashboard/help`), not a modal.
- **Incident actions**: `Assign to me` (assign to current user, becomes owner display), `Acknowledge` (records ack), `Notify` (sends to team, becomes static `Team notified`).
- **Hover**: `.16s ease` on background/color for all interactive elements. Icon buttons `rgba(255,255,255,.05) → .09`. Accent glass `rgba(61,139,255,.09) → .16`.
- **Mount**: `fadeUp .5s ease both` on main content.
- **Down status dots** pulse (`pulseDot 1.8s infinite`). Only down.
- **Loading**: skeleton the card/row shapes; keep the shell and nav painted immediately. Never a full-page spinner.
- **Errors**: inline, in-card, plain language. Red only for genuine failure.
- **Responsive**: designed desktop-first at 1360px max width; must survive to ~924px without header overlap or column collapse. Below that, stack the two-column body — not designed in detail.

## State Management

Prototype state that must be **replaced by real data / platform state**:

| Prototype state | Production source |
| --- | --- |
| `role` prop (`admin` \| `member`) | Clerk `orgRole` read server-side |
| `screen` | Next.js route |
| `scenario` (`attention` \| `calm`) | **Remove.** Prototype demo switcher only. |
| `density` prop | Optional user preference, or drop |
| `userName`, `orgName` | Clerk user + active organization |
| Monitor / incident / ticket / activity arrays | Supabase via `src/lib/db/*` |
| Sparkline points, uptime strip bars | Real check history |

Notes:
- The prototype seeds uptime-strip bars from a deterministic pseudo-random function purely so the mock looks plausible. **Replace with real check results.** Never ship synthesized status.
- The prototype re-renders on a 60s interval to keep relative times fresh. Real implementation should revalidate on a sensible cadence (or subscribe) rather than blind polling.
- Keep pages as **server components**; make only interactive leaves client components or server actions (chat input, forms, notify/acknowledge/assign, org switcher).

## Components to build

Reuse what already exists in the codebase: `StatusBadge` / `monitorStatus` (`src/app/dashboard/monitors/ui.tsx`) and `TicketStatusBadge` (`src/app/dashboard/tickets/ui.tsx`).

New, small, presentational:
1. **UptimeStrip** — 40 bars, `display: flex`, `gap: 1.5px`, `height: 26px`. Each bar `flex: 1 1 0; min-width: 0` so it compresses to fit its column (this was a real bug — bars with a min-width overflowed into the next column). `border-radius: 1px`. Up bars full height at `opacity: .82`; paused bars 38% height in `rgba(255,255,255,.13)`; down/pending in status color at full opacity. Container `overflow: hidden`.
2. **Sparkline** — plain SVG, `viewBox 0 0 200 40`, `preserveAspectRatio: none`, min/max normalized, area fill + 1.5px stroke, rounded joins. No chart library.
3. **KPICard**, **VerdictBanner**, **IncidentCard**, **SLABar**, **ActivityRow**, **Toggle**, **StatusDot**, **GlassNavPill**, **OrgPill**, **AIButton**, **DataTable** (grid-based row layout, not `<table>`).

Icons: inline SVG, `stroke-width: 1.8–2.4`, `stroke-linecap/linejoin: round` — matches Lucide, which the codebase already uses. No icon fonts.

## Assets
None. No images, no logo files, no external art. All iconography is inline SVG; the background is CSS gradients plus an inline SVG noise pattern. Fonts are Geist / Geist Mono (already in the project).

## Migration plan

**Phase 0 — tokens.** Nothing to invent; values above already map to `globals.css`. Verify names before use.

**Phase 1 — shell + role gating.** Header, glass nav pill, org pill, gear, avatar, floating AI pill. Read Clerk `orgRole` in `src/app/dashboard/layout.tsx`; render admin vs member nav from it and **redirect members off admin routes**. RLS remains the real boundary.

**Phase 2 — Overview.** Verdict banner, KPI strip (incl. sparkline), Monitors panel (scroll area), Open incidents, Ticket queue, Activity.

**Phase 3 — Monitors.** Full table + Add monitor.

**Phase 4 — Incidents.** Open cards + resolved list + assign/ack/notify actions.

**Phase 5 — Tickets.** Counts + table, incident linkage.

**Phase 6 — Settings.** Org, team, notifications, AI providers (BYOK).

**Phase 7 — End-user Help app.** Home, chat + escalate, submit request, my requests, personal settings.

Ship one feature per PR, each with a test. **Do not modify tenant-isolation tests.**

## Files in this bundle
| File | What it is |
| --- | --- |
| `Talvex Dashboard Flat.dc.html` | **Primary reference.** Admin dashboard, flat variant, role-aware (imports the Help app). |
| `Talvex Dashboard.dc.html` | Glass variant of the same screens. Alternate. |
| `Talvex Help.dc.html` | End-user Help app. Imported by the dashboards for the member view. |
| `support.js` | Runtime for the prototype format. **Not for production** — needed only to open the HTML files locally. |

To view: open either dashboard file in a browser. Flip the `role` prop between `admin` and `member` to see both personas.

## Open questions
1. **Light mode** — RESOLVED, not open. Light mode was removed; the product is dark only. See the `docs/DECISIONS.md` entry dated 2026-07-25.
2. **Client status page** — a simple embeddable public widget was requested and deferred. Not designed yet.
3. **SLA source** — SLA countdowns are shown but no SLA policy model was defined. Where do targets come from?
4. **Scope / blast radius** — "Affects ~8 people · Front desk, Booking" needs a data source (monitor→department/user mapping).
5. **Recurrence** — "3rd time this month" needs a defined lookback window.
6. **Last fix / runbooks** — needs a runbook model and a link from incident to prior resolution.
7. **Notify** — which channel(s) does it use, and who is "the team"?
8. **Mobile** — below ~924px is undesigned. Likely needed for the end-user Help app especially.
