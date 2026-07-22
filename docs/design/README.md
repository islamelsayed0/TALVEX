# Handoff: Talvex Sign In

## Overview
The sign-in screen for Talvex, an IT operations platform used by small offices
(law firms, dental practices, medical clinics) and the solo IT person who
supports them. The person signing in is often non-technical and can feel
anxious around IT tools, so the screen is deliberately calm, uncluttered, and
reassuring. Primary auth is Google; email and password is the fallback (BRD F2).
The screen supports both dark (default) and light themes with a toggle.

## About the Design Files
The files in this bundle are **design references created in HTML** — prototypes
that show the intended look and behavior. They are **not** production code to
copy directly. The task is to **recreate these designs in the Talvex codebase's
existing environment** (Next.js App Router + Clerk + Tailwind), using its
established patterns. The current sign-in route renders a default Clerk `<SignIn>`
widget; this design replaces that presentation.

## Fidelity
**High fidelity.** Final colors, typography, spacing, radii, shadows, and
interaction states are all specified below and should be matched closely. Where
Clerk owns a sub-flow (the OAuth redirect, the create-organization form), keep
Clerk's functionality and apply this visual language via Clerk `appearance`
options / theming rather than rebuilding the flow.

## Screens / Views

### 1. Sign In (primary) — `Talvex Sign In Final.dc.html`
- **Purpose:** the user signs in, or creates an account by continuing with Google.
- **Layout:** full-viewport (`min-height:100vh`), single centered column,
  `width: 340px`, vertically and horizontally centered. Page has `padding: 48px 0`
  and `overflow-y: auto` so the column scrolls instead of clipping on short
  viewports. Text is center-aligned throughout.
- **Vertical order & spacing (top to bottom):**
  - Logo mark tile → 20px gap → wordmark → 13px → subhead paragraph → 28px →
    Continue with Google button → 20px → "or use email" divider → email input →
    10px → password input → 9px → "Forgot password?" (right-aligned) → 16px →
    Continue with email button → 22px → reassurance line.
- **Theme toggle:** circular button, `40×40`, `position: absolute; top: 22px;
  right: 22px`. Shows a moon icon in dark mode, sun icon in light mode. Toggles
  the whole screen's theme.

**Components**
- **Logo mark:** `48×48`, `border-radius: 14px`, background
  `linear-gradient(150deg, #4d95ff, #2f6fd6)`, `box-shadow: 0 10px 28px -10px
  rgba(61,139,255,.6), inset 0 1px 0 rgba(255,255,255,.28)`. Inside: a `16×16`
  three-quarter ring (a `border: 2.5px solid` circle with
  `border-right-color: transparent`, rotated `-45deg`) — a quiet "monitoring"
  motif. Ring color is `#08111f` in dark, `#ffffff` in light. This is a
  placeholder mark; swap for the real Talvex logo when available.
- **Wordmark "Talvex":** Geist, `600`, `27px`, `letter-spacing: -0.022em`.
  Color `#f6f4f0` (dark) / `#17150f` (light).
- **Subhead:** "Everything about your systems, in one calm place. Sign in to
  pick up where you left off." Geist `400`, `14.5px`, `line-height: 1.55`,
  `max-width: 280px`, `text-wrap: pretty`. Color `#a7a39c` (dark) / `#6b675f` (light).
- **Continue with Google button (PRIMARY, the only accent element):**
  full width, `height: 52px`, `border-radius: 12px`, background `#3d8bff`,
  label Geist `600` `15px`. Label/icon color is `#08111f` (dark text) in dark
  mode, `#ffffff` in light mode. Shadow `0 10px 26px -12px rgba(61,139,255,.7),
  inset 0 1px 0 rgba(255,255,255,.3)`. Leading icon: `21×21` white circle with a
  `#3d8bff` "G" (Geist `700` `13px`) — a monochrome stand-in; the real Google
  multicolor logo would introduce red/green/yellow, which are reserved. Confirm
  branding requirements before shipping.
  - Hover: background `#4d97ff`, `transform: translateY(-1px)`, `transition: .16s`.
- **Divider:** two `1px` rules (`--divider`) with centered label "or use email"
  (`11px`, `--muted`).
- **Email / Password inputs:** full width, `height: 48px`, `border-radius: 11px`,
  `padding: 0 15px`, Geist `400` `14px`. Background `--field-bg`, border
  `1px solid --field-border`, text `--field-text`, placeholder `--placeholder`.
  - Focus: `border-color: rgba(61,139,255,.6)`, background `--field-bg-focus`.
- **Forgot password? link:** right-aligned, `12px`, color `--link`, `1px` bottom
  border `--link-border`.
- **Continue with email button (SECONDARY / neutral — no accent):** full width,
  `height: 48px`, `border-radius: 11px`, transparent background,
  `border: 1px solid --ghost-border`, label Geist `600` `14px` color
  `--ghost-text`. Kept neutral on purpose so blue stays exclusive to the primary
  Google action.
  - Hover: `border-color: --ghost-border-hover`, background `--ghost-hover-bg`.
- **Reassurance line:** "Protected and private. Your data stays yours." `11.5px`,
  color `--muted`.

### Additional states & screens — `Talvex Sign In.dc.html` (exploration file)
This file holds every explored option and state, grouped by turn (newest at top):
- **Turn 4 — email/password fallback:** 4a (fields inline, the finalized choice)
  and 4b (fallback tucked behind a "Sign in with email" link).
- **Turn 3 — light mode, states, next screen, framed view:**
  - **3a** light-mode sign in.
  - **3b** two states: *Redirecting to Google* (spinner, "Taking you to Google /
    One moment. This is safe to leave open.") and *Error* ("That did not go
    through" + calm retry, no red).
  - **3c** *Choose an organization* — the Clerk `/select-org` step, styled to
    match. Copy: "Everything in Talvex belongs to an organization. Pick one or
    create your first." Org rows + "Create your first organization".
  - **3d** the sign-in shown in a browser frame at `talvex.app/signin`.
- **Turns 1–2** are the wireframe → mid-fi → hi-fi progression that led here.

## Interactions & Behavior
- **Continue with Google:** starts the Clerk Google OAuth flow. Show the
  *Redirecting* state (3b) while navigating.
- **Continue with email:** submits email + password via Clerk password strategy.
  Validate email format and required password; on failure show the calm error
  pattern (3b) — never red, never blaming the user.
- **Forgot password?:** Clerk password-reset flow.
- **Theme toggle:** flips dark/light. In the prototype this is component state;
  in production persist the choice (localStorage or user setting) and respect
  `prefers-color-scheme` on first load.
- **Transitions:** page background `0.3s ease`; buttons/inputs `0.16s ease` on
  hover/focus. Primary button lifts `1px` on hover.
- **After sign in:** org-less sessions route to `/select-org` (3c), then
  `/dashboard`.

## State Management
- `theme: 'dark' | 'light'` — drives the `data-theme` attribute on the root; all
  colors are CSS custom properties keyed off it.
- Form: `email`, `password`, `submitting`, `error` (delegated to Clerk in prod).

## Design Tokens

### Accent (single accent color, primary action only)
- Blue `#3d8bff` · hover `#4d97ff` · gradient stops `#4d95ff` → `#2f6fd6`
- Button text on blue: `#08111f` (dark theme) / `#ffffff` (light theme)
- **Never** use green, amber, or red anywhere — reserved for status meaning.

### Dark theme
- Page: `radial-gradient(130% 100% at 50% -8%, #17140f 0%, #0d0b09 55%, #0b0a08 100%)`
- Accent glow: `rgba(61,139,255,.07)`
- Wordmark / primary text: `#f6f4f0`
- Subhead: `#a7a39c` · Muted: `#6f6b65`
- Divider: `rgba(255,255,255,.09)`
- Field bg `#141210` / focus `#171512` · border `rgba(255,255,255,.1)` · text `#eeece7`
- Ghost border `rgba(255,255,255,.16)` / hover `rgba(255,255,255,.32)` · text `#e8e6e2` · hover bg `rgba(255,255,255,.03)`
- Mark ring `#08111f` · Link `#8f8b84`
- Toggle bg `rgba(255,255,255,.05)` · border `rgba(255,255,255,.12)`

### Light theme
- Page: `radial-gradient(130% 100% at 50% -8%, #ffffff 0%, #f4f6f9 58%, #eef1f5 100%)` (flat equivalent `#f4f6f9`)
- Accent glow: `rgba(61,139,255,.08)`
- Wordmark / primary text: `#17150f`
- Subhead: `#6b675f` · Muted: `#a29e95`
- Divider: `rgba(0,0,0,.1)`
- Field bg `#ffffff` · border `rgba(0,0,0,.12)` · text `#17150f`
- Ghost border `rgba(0,0,0,.14)` / hover `rgba(0,0,0,.28)` · text `#2a2822` · hover bg `rgba(0,0,0,.03)`
- Mark ring `#ffffff` · Link `#6b675f`
- Toggle bg `rgba(0,0,0,.04)` · border `rgba(0,0,0,.12)`

### Typography
- Family: **Geist** (already the codebase font, `--font-geist-sans`).
- Wordmark `600 / 27px / -0.022em`; subhead `400 / 14.5px / 1.55`;
  button labels `600 / 14–15px`; inputs `400 / 14px`; small print `400 / 11.5–12px`.

### Radii
- Logo tile `14px` · primary button `12px` · inputs & secondary button `11px` · toggle `999px`.

### Shadows
- Logo tile: `0 10px 28px -10px rgba(61,139,255,.6), inset 0 1px 0 rgba(255,255,255,.28)`
- Primary button: `0 10px 26px -12px rgba(61,139,255,.7), inset 0 1px 0 rgba(255,255,255,.3)`

### Spacing
- Column width `340px`; page padding `48px 0`; vertical rhythm 13 / 16 / 20 / 22 / 28px as listed per screen.

## Copy rules (hard constraints)
- **No hyphens anywhere in visible text.** (Any auth path or displayed URL must
  avoid them — e.g. show `talvex.app/signin`, not a hyphenated form.)
- Tone is calm and human, no jargon. Errors reassure, never blame.

## Assets
- **Logo mark:** placeholder built in CSS (blue gradient tile + three-quarter
  ring). Replace with the real Talvex logo.
- **Google "G":** monochrome placeholder. Decide on official Google branding vs.
  the monochrome treatment before shipping, given the no red/green/amber rule.
- **Font:** Geist, loaded via `next/font/google` in the codebase.

## Files
- `Talvex Sign In Final.dc.html` — the finalized primary screen (dark + light + toggle).
- `Talvex Sign In.dc.html` — full exploration: wireframes, hi-fi, states (loading/error), light mode, select-org, browser frame.
- Codebase reference: `src/app/sign-in/[[...sign-in]]/page.tsx`,
  `src/app/select-org/page.tsx`, `src/app/layout.tsx`, `src/app/globals.css`.
