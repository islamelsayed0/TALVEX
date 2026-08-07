/**
 * Every word on the public pricing page (F13 PR 4), held in one module the
 * way the landing copy is, so tests/pricing-page.test.ts can pin the frozen
 * numbers (docs/DECISIONS.md 2026-08-07), the standing promises, and the
 * house rules (no hyphens in prose, no word MSP, no claims the code cannot
 * back).
 *
 * TRUTH GATE: this page merges unlinked. Nothing on the landing page points
 * here until billing goes live behind the recorded human gates; the test
 * asserts the absence of the link too.
 */

export type PricingTier = {
  name: string
  /** The monthly price as displayed, or null for the tier with no price. */
  price: string | null
  blurb: string
  includes: string[]
  cta: { label: string; href: string }
}

export const PRICING_HERO = {
  title: 'Pricing',
  sub: 'Five plans, one honest shape: alerts are never held back, seats are never counted, and nothing upgrades on its own.',
}

export const PRICING_TIERS: PricingTier[] = [
  {
    name: 'Free',
    price: '$0',
    blurb: 'A real tier, not a trial.',
    includes: [
      '1 organization',
      '2 monitors',
      'Tickets and incident alerts',
      'BYOK AI chat: bring your own provider key, chat free forever',
    ],
    cta: { label: 'Start free', href: '/sign-up' },
  },
  {
    name: 'Basic',
    price: '$39',
    blurb: 'For offices up to around 20 staff.',
    includes: [
      '1 organization',
      '15 monitors',
      'Public status page',
      'Daily digest',
      'SSL expiry warnings',
      'Maintenance windows',
    ],
    cta: { label: 'Start free, upgrade inside', href: '/sign-up' },
  },
  {
    name: 'Pro',
    price: '$79',
    blurb: 'Everything unlimited, AI included.',
    includes: [
      '1 organization',
      'Unlimited monitors',
      'Documents with audience targeting',
      'Inventory and audit log',
      '300 managed AI answers a month included',
    ],
    cta: { label: 'Start free, upgrade inside', href: '/sign-up' },
  },
  {
    name: 'Business',
    price: '$199',
    blurb: 'Every client or location, one account.',
    includes: [
      'Up to 10 organizations',
      'Everything in Pro',
      '300 managed AI answers a month included',
    ],
    cta: { label: 'Start free, upgrade inside', href: '/sign-up' },
  },
  {
    name: 'Custom',
    price: null,
    blurb: 'Something bigger, or shaped differently.',
    includes: ['Tell us what you run and what you need.'],
    cta: { label: 'Contact us', href: 'mailto:islamelsayed02@gmail.com' },
  },
]

export const AI_ADDON = {
  name: 'AI Chat add on',
  price: '$15',
  blurb:
    '300 managed AI answers a month, added to the Basic plan. Pro and Business already include the same allowance.',
}

/** The standing promises, stated plainly and pinned by test. */
export const PRICING_PROMISES = [
  {
    title: 'Alerts are never held back',
    body: 'Incident alerts are included on every tier, always. A monitoring product that holds an outage notification behind a paywall is the thing we refuse to be.',
  },
  {
    title: 'Seats are never counted',
    body: 'Invite your whole team on any plan. Nothing here is priced per person, and nothing ever will be quietly switched to be.',
  },
  {
    title: 'Caps degrade politely',
    body: 'If a plan’s included AI answers run out, chat points you to your ticket queue in plain words. No silent failures, no automatic upgrades, no overage charges.',
  },
  {
    title: 'BYOK is free everywhere',
    body: 'Bring your own AI provider key on any tier, the Free tier included, and chat is uncapped and unmetered. The managed allowance only ever covers answers on our key.',
  },
]

export const PRICING_FOOTNOTE =
  'Prices are per organization account, in US dollars, monthly. Upgrades and cancellation happen inside the app under Settings, then Billing.'
