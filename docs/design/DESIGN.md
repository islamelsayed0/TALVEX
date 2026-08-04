# Talvext — Master Design Document

The single entry point for how Talvext looks and why. It defines the design
language, the token system, the component vocabulary, and the screen inventory,
and points to the detailed handoffs and the decision log for the rest. If a
design question is not answered here, the order is: this document → the relevant
handoff → `docs/DECISIONS.md` → ask.

Source of truth for values is [`src/app/globals.css`](../../src/app/globals.css);
this document describes and indexes it, it does not restate every number. The
rules below are enforced by [`tests/design-tokens.test.ts`](../../tests/design-tokens.test.ts).

---

## 1. Principles

Talvext is used by small offices (medical, legal, small IT) and the one person
who keeps their systems running. That person is often non technical and a little
anxious around IT tools. Every screen answers to that.

- **One screen, one obvious action, no jargon.** If a screen fails that, it gets
  rebuilt. This is the rule the landing page states out loud, and it governs the
  Help app in particular.
- **Calm over dense.** Flat surfaces, generous space, a single accent. Colour is
  used sparingly and always means something.
- **Honest by default.** Screens show real data with honest empty states.
  Nothing is faked to look fuller than it is; the landing page uses real product
  screenshots, and only advertises what actually ships.
- **Dark only.** One palette, set statically. See §6 and the 2026-07-25 decision.

---

## 2. Foundations — the token system

All colour, type, radii, shadows, and fonts live as CSS custom properties in
`:root`, mapped to Tailwind utilities through `@theme inline`. **Components never
hardcode a hex value or a raw shadow**; they read a token or a component class.
The only sanctioned literals in component markup are translucent white/black for
glass (e.g. `bg-white/[0.14]`) and blue rgba, because the reserved rule guards
the status hues, not neutrals or the accent.

### Colour

| Group | Tokens (utilities) | Notes |
| --- | --- | --- |
| Page | `background`, page gradient, glow | `--background #0b0a08` |
| Text | `foreground`, `secondary-foreground`, `chip-text`, `muted-foreground`, `quiet`, `link` | Every pair clears WCAG AA on its background |
| Accent | `primary`, `primary-hover`, `primary-foreground`, `accent-text` | The **single** accent, blue. Primary actions and one word of emphasis only |
| Surfaces | `card`, `card-foreground`, `card-hover`, `border`, `card-border`, `divider`, `tile`, `tile-border` | Cards are flat; only chrome is glass |
| Fields | `field`, `field-focus`, `input`, `field-text`, `placeholder`, `ring` | |
| Status (reserved) | `status-up` (green), `status-down` (red), `status-pending` (amber), `status-paused` (grey) | **Meaning only.** Green/amber/red may not be used decoratively or redefined |
| Washes | `wash-up`, `wash-down`, `wash-accent` | Translucent status/accent fills behind icons and chips |

### Type

Two families. **Geist** is the body/UI face and the default on `<body>`.
**General Sans** (`font-display`) is the display face for headings, self hosted
via `next/font/local` ([`src/lib/fonts/general-sans.ts`](../../src/lib/fonts/general-sans.ts)).
**Geist Mono** (`font-mono`) is for numbers, timestamps, and code-like labels.

Named type roles exist as tokens for sizes reused across screens:
`text-wordmark`, `text-brand`, `text-title`, `text-kpi`, `text-subhead`,
`text-column`, `text-section`, `text-chip`. One-off display sizes (the landing
hero, section headings) use Tailwind utilities with `clamp()`.

### Radii, shadows, motion

- **Radii:** `rounded-tile` (14), `rounded-button` (12), `rounded-field` (11),
  `rounded-card` (20), `rounded-kpi` (18), `rounded-nested` (16), `rounded-nav`
  (9), `rounded-mini` (8). Pills use `rounded-full`.
- **Shadows:** `shadow-tile`, `shadow-primary`, `shadow-card`, `shadow-cta`
  (the landing CTA glow). First class so Turbopack emits them deterministically —
  arbitrary `shadow-[…]` utilities are avoided on purpose (see §6).
- **Motion:** `animate-fade-up` (mount), `animate-pulse-dot` (live status).
  Everything is disabled under `prefers-reduced-motion`.

---

## 3. Component vocabulary

Reusable treatments live as component classes in `globals.css` (`@layer
components`), so their values sit in one place.

| Class | Where | What |
| --- | --- | --- |
| `.page-auth` | Auth screens | Full-viewport gradient + glow + film grain |
| `.glass` / `.glass-accent` | Dashboard chrome | The one translucent treatment: nav pill, org pill, the accent `Ask Talvext` pill. Cards stay flat |
| `.nav-item` | Nav pills | Neutral, lifting to an inset highlight when `aria-current="page"` |
| `.liquid-glass` | Landing | The faintest glass, over the background video: nav pill and the secondary CTA |
| `.landing-frame` | Landing | Browser-chrome product-shot panel, deep shadow |
| `.landing-panel` | Landing | Softer card variant: the "rule" callout, the "who it's for" cards |
| `.landing-hero-overlay` / `.landing-hero-video` | Landing | Fixed vignette + the pinned, muted, fading background video |

Shared UI primitives (Card, StatusDot, KpiCard, Sparkline, badges, etc.) live in
[`src/app/dashboard/_overview/ui.tsx`](../../src/app/dashboard/_overview/ui.tsx)
and are imported across the dashboard screens.

---

## 4. Screen inventory

| Surface | Route | Spec / reference |
| --- | --- | --- |
| **Sign in / sign up** | `/sign-in`, `/sign-up` | Handoff: [`docs/design/README.md`](README.md). Clerk widget themed via `appearance`; chrome owns the layout |
| **Dashboard (admin)** | `/dashboard`, `/monitors`, `/incidents`, `/tickets`, `/settings` | Handoff: [`docs/design/handoff/README.md`](handoff/README.md) |
| **Help (end user)** | `/dashboard/help` and children | Same handoff, "Screens — End user". The plainest surface: one screen, one action |
| **Landing (public)** | `/` | This document, §5 |

Reference renders for every screen are in
[`docs/design/screenshots/`](screenshots/) (the `*-dark.png` set is current;
`*-light.png` predate the dark-only decision and are historical).

Detail pages, forms, and the chat experience are still on pre-reskin styling and
are tracked as follow-up work, not yet part of the locked design.

---

## 5. Landing page (`/`)

The public marketing page, recreated from the `Talvex Landing` design in the app
stack ([`src/app/page.tsx`](../../src/app/page.tsx) + the client
[`_landing/hero-background.tsx`](../../src/app/_landing/hero-background.tsx)).

- **Structure:** sticky header (wordmark, `.liquid-glass` nav pill, auth link) →
  hero "One *calm* place" → product proof (overview shot, the grounded chat
  split, status page + inventory pair) → the problem → what Talvext is + the rule
  → features (hairline definition rows, one per shipped capability) → how it's
  built → who it's for → start free → footer.
- **Copy lives in one module:** every prose string is in
  [`src/app/_landing/copy.ts`](../../src/app/_landing/copy.ts), guarded by
  `tests/landing-copy.test.ts` (no hyphens, "documents" never "articles", no
  claims the code cannot back — nothing automatic about tickets, no SMS, no
  quiet hours, nothing implying HIPAA or certification).
- **Background:** a muted, looping, self-hosted video (`public/landing/hero.mp4`)
  under a fixed vignette. Muting is guaranteed three ways (attribute, reassert on
  mount, volume pinned to 0) — there is no audio we ever want to hear.
- **Product shots are real:** the four framed screenshots in `public/landing/`
  (overview with the sidebar, a chat citing documents, the public status page,
  the inventory list with a Low stock chip) are captured from the running app's
  Northwind Dental demo org, not mockups. Retake them when the screens change;
  a stale screenshot is treated as a false claim.
- **Motion:** hero fades up on mount (`animate-fade-up`); sections use
  `.scroll-reveal`, a CSS only `animation-timeline: view()` entrance that
  degrades to static in unsupporting browsers and is off under reduced motion.
- **Auth aware:** CTAs and the header link swap via Clerk `Show` — signed-out
  sees *Start free* / *Sign in*, signed-in sees *Go to dashboard*.
- **Verification:** `tests/e2e/landing.spec.mjs` runs against a live app — the
  shots resolve, the sign up CTA reaches the Clerk widget, the rendered text
  keeps the no hyphen rule, and a phone viewport never scrolls sideways.

---

## 6. Rules (enforced)

1. **No hardcoded hex in components.** Read a token or a component class.
   Exceptions: neutral white/black rgba for glass, and blue rgba for the accent.
2. **Reserved status colour.** Green, amber, and red carry status meaning only,
   and exist only as the `--status-*` tokens. No decorative use, no new ones.
3. **Contrast.** Every text/background pair meets WCAG AA (BRD D5).
4. **Dark only.** No `[data-theme="light"]`; the `:root` tokens are the one
   palette. The `dark` variant is kept as a harmless safety net.
5. **First-class utilities over arbitrary `[]`.** Shadows, gradients, and
   animations are declared in `@theme` so Tailwind v4 under Turbopack emits them
   deterministically. Fragile arbitrary utilities were the cause of the dev
   stylesheet going stale while the production build was correct.
6. **No hyphens in user-facing copy.** Use en dashes or rewrite (CLAUDE.md).

---

## 7. Related documents

- [`docs/design/handoff/README.md`](handoff/README.md) — full dashboard + Help handoff
- [`docs/design/README.md`](README.md) — sign-in handoff
- [`docs/DECISIONS.md`](../DECISIONS.md) — the decision log (dark-only, landing pulled forward, etc.)
- [`docs/BRD.md`](../BRD.md) — product requirements
- [`src/app/globals.css`](../../src/app/globals.css) — the tokens themselves
- [`tests/design-tokens.test.ts`](../../tests/design-tokens.test.ts) — the guard
