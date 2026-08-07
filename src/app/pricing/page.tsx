import Link from 'next/link'

import { SiteFooter } from '@/components/site-footer'

import {
  AI_ADDON,
  PRICING_FOOTNOTE,
  PRICING_HERO,
  PRICING_PROMISES,
  PRICING_TIERS,
} from './copy'

export const metadata = {
  title: 'Pricing — Talvext',
  description: PRICING_HERO.sub,
}

/**
 * The public pricing page (F13 PR 4). Public by construction like the legal
 * pages: the proxy only protects /dashboard and /select-org, and
 * tests/auth-routes.test.ts holds this route open.
 *
 * TRUTH GATE: this route exists UNLINKED. The landing nav gains a Pricing
 * link only when billing goes live behind the recorded human gates
 * (docs/DECISIONS.md 2026-08-07); tests/pricing-page.test.ts fails if the
 * link appears early. No logos, no testimonials, no customer counts: the
 * page states the frozen pricing and the standing promises, nothing it
 * cannot back.
 *
 * Dark tokens throughout, the locked palette; the shell mirrors the legal
 * layout (wordmark home, footer) rather than the landing's liquid glass nav,
 * because a pricing page is a document, not a show.
 */

export default function PricingPage() {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-border px-8 py-[18px]">
        <div className="mx-auto flex max-w-[1240px] items-center justify-between gap-6">
          <Link
            href="/"
            className="font-display text-[22px] font-semibold tracking-[-0.02em] text-foreground"
          >
            Talvext
          </Link>
          <Link
            href="/sign-in"
            className="text-[14.5px] font-medium text-secondary-foreground transition-colors hover:text-foreground"
          >
            Sign in
          </Link>
        </div>
      </header>

      <main id="main-content" className="flex-1 px-8 pt-16 pb-24">
        <div className="mx-auto max-w-[1100px]">
          <h1 className="font-display text-[clamp(40px,6vw,64px)] font-normal leading-[1.06] tracking-[-0.025em] text-foreground">
            {PRICING_HERO.title}
          </h1>
          <p className="mt-4 max-w-[560px] text-[16px] leading-relaxed text-muted-foreground">
            {PRICING_HERO.sub}
          </p>

          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {PRICING_TIERS.map((tier) => (
              <section
                key={tier.name}
                aria-label={`${tier.name} plan`}
                className="flex flex-col rounded-card border border-card-border bg-card p-5 shadow-card"
              >
                <h2 className="text-[15px] font-semibold text-foreground">{tier.name}</h2>
                <p className="mt-1.5 text-[24px] font-semibold tracking-[-0.01em] text-foreground">
                  {tier.price ?? 'Let’s talk'}
                  {tier.price ? (
                    <span className="text-[13px] font-normal text-quiet"> a month</span>
                  ) : null}
                </p>
                <p className="mt-1 text-[12.5px] text-quiet">{tier.blurb}</p>
                <ul className="mt-3 flex-1 space-y-1">
                  {tier.includes.map((line) => (
                    <li
                      key={line}
                      className="border-t border-divider py-1.5 text-[12.5px] text-foreground first:border-t-0"
                    >
                      {line}
                    </li>
                  ))}
                </ul>
                <Link
                  href={tier.cta.href}
                  className="mt-4 inline-flex items-center justify-center rounded-button border border-(--ghost-border) px-3 py-2 text-[13px] font-semibold text-ghost-text transition-colors hover:border-(--ghost-border-hover) hover:bg-(--ghost-hover-bg)"
                >
                  {tier.cta.label}
                </Link>
              </section>
            ))}
          </div>

          <section
            aria-label={AI_ADDON.name}
            className="mt-4 rounded-card border border-card-border bg-card px-5 py-4 shadow-card"
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-[15px] font-semibold text-foreground">{AI_ADDON.name}</h2>
              <p className="text-[15px] font-semibold text-foreground">
                {AI_ADDON.price}
                <span className="text-[12.5px] font-normal text-quiet"> a month</span>
              </p>
            </div>
            <p className="mt-1 max-w-[640px] text-[12.5px] text-quiet">{AI_ADDON.blurb}</p>
          </section>

          <div className="mt-16 grid gap-8 sm:grid-cols-2">
            {PRICING_PROMISES.map((promise) => (
              <section key={promise.title} aria-label={promise.title}>
                <h2 className="text-[15px] font-semibold text-foreground">
                  {promise.title}
                </h2>
                <p className="mt-1.5 max-w-[460px] text-[13.5px] leading-relaxed text-muted-foreground">
                  {promise.body}
                </p>
              </section>
            ))}
          </div>

          <p className="mt-14 text-[12px] text-quiet">{PRICING_FOOTNOTE}</p>
        </div>
      </main>

      <SiteFooter />
    </div>
  )
}
