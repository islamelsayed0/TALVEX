import { Show } from '@clerk/nextjs'
import Image from 'next/image'
import Link from 'next/link'

import { SiteFooter } from '@/components/site-footer'

import {
  AUDIENCE,
  BUILT,
  FEATURES,
  FEATURES_LEAD,
  HERO,
  PROBLEM,
  PROOF,
  REPO_URL,
  STEPS,
  WHAT,
} from './_landing/copy'
import { HeroBackground } from './_landing/hero-background'

export const metadata = {
  title: 'Talvex — one calm place for your systems',
  description: HERO.sub,
}

// Shared class strings. The primary CTA glow (shadow-cta) and the glass
// treatments (.liquid-glass, .landing-frame, .landing-panel) are first class in
// globals.css, so nothing here hardcodes a color or a shadow.
const CTA_PRIMARY =
  'inline-block rounded-full bg-primary font-semibold text-primary-foreground shadow-cta transition-opacity hover:opacity-90'
const EYEBROW =
  'mb-5 text-[12px] font-semibold uppercase tracking-[0.1em] text-accent-text'
const NAV_LINK =
  'rounded-full px-[15px] py-[9px] text-[14.5px] font-medium text-secondary-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground'
// The 128px top rhythm the design uses between major sections.
const SECTION = 'mx-auto max-w-[1240px] px-8 pt-32'

/** Browser chrome header for a framed product shot. */
function FrameBar({ url, small = false }: { url: string; small?: boolean }) {
  const dot = small ? 'h-2 w-2' : 'h-[9px] w-[9px]'
  return (
    <div className="flex items-center gap-2 px-2.5 pb-3 pt-1.5">
      <span className={`${dot} rounded-full bg-white/[0.14]`} />
      <span className={`${dot} rounded-full bg-white/[0.14]`} />
      <span className={`${dot} rounded-full bg-white/[0.14]`} />
      <span
        className={`ml-2 font-mono ${small ? 'text-[11.5px]' : 'text-[12px]'} text-quiet`}
      >
        {url}
      </span>
    </div>
  )
}

export default function Home() {
  return (
    <>
      <HeroBackground />

      <div className="relative z-[2] flex flex-1 flex-col">
        {/* Header */}
        <header className="sticky top-0 z-50 px-8 py-[18px]">
          <div className="mx-auto flex max-w-[1240px] items-center justify-between gap-6">
            <Link
              href="#top"
              className="font-display text-[22px] font-semibold tracking-[-0.02em] text-foreground"
            >
              Talvex
            </Link>
            <nav className="liquid-glass hidden items-center gap-0.5 rounded-full px-1.5 py-[5px] md:flex">
              <Link href="#product" className={NAV_LINK}>
                Product
              </Link>
              <Link href="#problem" className={NAV_LINK}>
                The problem
              </Link>
              <Link href="#what" className={NAV_LINK}>
                What it is
              </Link>
              <Link href="#features" className={NAV_LINK}>
                Features
              </Link>
              <Link href="#built" className={NAV_LINK}>
                How it&apos;s built
              </Link>
              <Link href="#who" className={NAV_LINK}>
                Who it&apos;s for
              </Link>
            </nav>
            <Show when="signed-out">
              <Link
                href="/sign-in"
                className="whitespace-nowrap text-[14.5px] font-medium text-secondary-foreground transition-colors hover:text-foreground"
              >
                Sign in
              </Link>
            </Show>
            <Show when="signed-in">
              <Link
                href="/dashboard"
                className="whitespace-nowrap text-[14.5px] font-medium text-secondary-foreground transition-colors hover:text-foreground"
              >
                Dashboard
              </Link>
            </Show>
          </div>
        </header>

        {/* 1. Hero */}
        <section
          id="top"
          className="flex min-h-[calc(78vh-76px)] items-center justify-center px-8"
        >
          <div className="animate-fade-up text-center">
            <h1 className="font-display text-[clamp(64px,11vw,132px)] font-normal leading-[1.04] tracking-[-0.028em] text-foreground">
              One <span className="text-accent-text">calm</span> place
            </h1>
            <p className="mx-auto mt-4 max-w-[36rem] text-pretty text-[18px] leading-[1.7] text-muted-foreground">
              {HERO.sub}
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3.5">
              <Show when="signed-out">
                <Link href="/sign-up" className={`${CTA_PRIMARY} px-8 py-5 text-base`}>
                  Start free
                </Link>
              </Show>
              <Show when="signed-in">
                <Link
                  href="/dashboard"
                  className={`${CTA_PRIMARY} px-8 py-5 text-base`}
                >
                  Go to dashboard
                </Link>
              </Show>
              <Link
                href="#product"
                className="liquid-glass inline-block rounded-full px-8 py-5 text-base font-semibold text-foreground transition-opacity hover:opacity-85"
              >
                See the product
              </Link>
            </div>
          </div>
        </section>

        <div className="landing-body">
        {/* 2. Product proof */}
        <section id="product" className="mx-auto max-w-[1240px] px-8 pt-16">
          <div className="scroll-reveal landing-frame rounded-[22px] p-2.5">
            <FrameBar url="talvex.app/dashboard" />
            <div className="relative aspect-[16/10] overflow-hidden rounded-tile">
              <Image
                src="/landing/dashboard-shot.png"
                alt={PROOF.overviewAlt}
                fill
                priority
                sizes="(max-width: 1240px) 100vw, 1240px"
                className="object-cover object-top"
              />
            </div>
          </div>
          <p className="mx-auto mt-5 max-w-[40rem] text-pretty text-center text-[15px] leading-[1.65] text-quiet">
            {PROOF.overviewCaption}
          </p>

          <div className="mt-24 grid grid-cols-1 items-center gap-14 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
            <div className="scroll-reveal">
              <h2 className="text-balance font-display text-[clamp(26px,3.2vw,38px)] font-semibold leading-[1.12] tracking-[-0.028em] text-foreground">
                {PROOF.chatHeading}
              </h2>
              <p className="mt-[18px] text-pretty text-[16.5px] leading-[1.65] text-muted-foreground">
                {PROOF.chatBody1}
              </p>
              <p className="mt-4 text-pretty text-[16.5px] leading-[1.65] text-muted-foreground">
                {PROOF.chatBody2}
              </p>
            </div>
            <div className="scroll-reveal landing-frame rounded-card p-[9px]">
              <FrameBar url="talvex.app/dashboard/chat" small />
              <div className="relative aspect-[16/10] overflow-hidden rounded-[13px]">
                <Image
                  src="/landing/chat-shot.png"
                  alt={PROOF.chatAlt}
                  fill
                  sizes="(max-width: 768px) 100vw, 700px"
                  className="object-cover object-top"
                />
              </div>
            </div>
          </div>

          <div className="mt-16 grid grid-cols-1 gap-8 md:grid-cols-2">
            <div className="scroll-reveal">
              <div className="landing-frame rounded-card p-[9px]">
                <FrameBar url="talvex.app/status/northwind" small />
                <div className="relative aspect-[16/10] overflow-hidden rounded-[13px]">
                  <Image
                    src="/landing/status-shot.png"
                    alt={PROOF.statusAlt}
                    fill
                    sizes="(max-width: 768px) 100vw, 590px"
                    className="object-cover object-top"
                  />
                </div>
              </div>
              <p className="mt-4 text-pretty text-[14.5px] leading-[1.6] text-quiet">
                {PROOF.statusCaption}
              </p>
            </div>
            <div className="scroll-reveal">
              <div className="landing-frame rounded-card p-[9px]">
                <FrameBar url="talvex.app/dashboard/inventory" small />
                <div className="relative aspect-[16/10] overflow-hidden rounded-[13px]">
                  <Image
                    src="/landing/inventory-shot.png"
                    alt={PROOF.inventoryAlt}
                    fill
                    sizes="(max-width: 768px) 100vw, 590px"
                    className="object-cover object-top"
                  />
                </div>
              </div>
              <p className="mt-4 text-pretty text-[14.5px] leading-[1.6] text-quiet">
                {PROOF.inventoryCaption}
              </p>
            </div>
          </div>
        </section>

        {/* 3. The problem */}
        <section id="problem" className={SECTION}>
          <div className="scroll-reveal max-w-[44rem]">
            <div className={EYEBROW}>The problem</div>
            {PROBLEM.map((para, i) => (
              <p
                key={i}
                className={`text-pretty font-display text-[clamp(21px,2.4vw,27px)] font-normal leading-[1.6] tracking-[-0.012em] text-ghost-text ${i > 0 ? 'mt-7' : ''}`}
              >
                {para}
              </p>
            ))}
          </div>
        </section>

        {/* 4. What Talvex is */}
        <section id="what" className={SECTION}>
          <div className="grid grid-cols-1 items-start gap-14 md:grid-cols-[17rem_minmax(0,1fr)]">
            <h2 className="scroll-reveal text-balance font-display text-[clamp(26px,3.2vw,38px)] font-semibold leading-[1.12] tracking-[-0.028em] text-foreground">
              What Talvex is
            </h2>
            <div className="scroll-reveal max-w-[44rem]">
              <p className="text-pretty font-display text-[clamp(19px,2vw,23px)] font-normal leading-[1.62] tracking-[-0.01em] text-ghost-text">
                {WHAT.intro}
              </p>
              <div className="landing-panel mt-9 rounded-card px-8 py-[30px]">
                <div className="mb-3.5 font-mono text-[12px] font-medium uppercase tracking-[0.08em] text-quiet">
                  {WHAT.ruleLabel}
                </div>
                <p className="text-pretty text-[16.5px] leading-[1.65] text-secondary-foreground">
                  {WHAT.rule}
                </p>
                <p className="mt-4 text-[16.5px] font-medium leading-[1.65] text-foreground">
                  {WHAT.ruleClose}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* 5. Features */}
        <section id="features" className={SECTION}>
          <div className="scroll-reveal max-w-[44rem]">
            <div className={EYEBROW}>{FEATURES_LEAD.eyebrow}</div>
            <h2 className="mb-4 text-balance font-display text-[clamp(30px,4vw,46px)] font-semibold leading-[1.1] tracking-[-0.03em] text-foreground">
              {FEATURES_LEAD.heading}
            </h2>
            <p className="text-pretty text-[16.5px] leading-[1.65] text-muted-foreground">
              {FEATURES_LEAD.sub}
            </p>
          </div>
          <div className="mt-13 flex max-w-[54rem] flex-col">
            {FEATURES.map((f, i) => (
              <div
                key={f.title}
                className={`scroll-reveal grid grid-cols-1 gap-2 border-t border-border py-6 sm:grid-cols-[15rem_1fr] sm:gap-8 ${i === FEATURES.length - 1 ? 'border-b' : ''}`}
              >
                <div className="text-[16px] font-semibold text-foreground">
                  {f.title}
                </div>
                <p className="text-pretty text-[15.5px] leading-[1.65] text-muted-foreground">
                  {f.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* 6. How it's built */}
        <section id="built" className={SECTION}>
          <div className="max-w-[44rem]">
            <div className="scroll-reveal">
              <div className={EYEBROW}>How it&apos;s built</div>
              <h2 className="mb-10 text-balance font-display text-[clamp(30px,4vw,46px)] font-semibold leading-[1.1] tracking-[-0.03em] text-foreground">
                Built to be checked
              </h2>
            </div>
            <div className="flex flex-col">
              {BUILT.map((body, i) => (
                <div
                  key={i}
                  className={`scroll-reveal grid grid-cols-[2.2rem_1fr] gap-[18px] border-t border-border py-[22px] ${i === BUILT.length - 1 ? 'border-b' : ''}`}
                >
                  <span className="pt-[3px] font-mono text-[13px] font-medium text-quiet">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <p className="text-pretty text-[16.5px] leading-[1.65] text-secondary-foreground">
                    {body}
                  </p>
                </div>
              ))}
            </div>
            <p className="scroll-reveal mt-8 text-pretty text-[15px] leading-[1.65] text-quiet">
              None of this asks for trust. The codebase is public, so every line
              above can be read in the{' '}
              <a
                href={REPO_URL}
                className="font-medium text-link transition-colors hover:text-foreground"
              >
                repository
              </a>
              .
            </p>
          </div>
        </section>

        {/* 7. Who it's for */}
        <section id="who" className={SECTION}>
          <div className="scroll-reveal max-w-[44rem]">
            <div className={EYEBROW}>Who it&apos;s for</div>
            <h2 className="text-balance font-display text-[clamp(30px,4vw,46px)] font-semibold leading-[1.1] tracking-[-0.03em] text-foreground">
              Small offices, not enterprise sprawl
            </h2>
            <p className="mt-[18px] text-pretty text-[16.5px] leading-[1.65] text-muted-foreground">
              Built for small and mid sized businesses where IT is one person,
              or one person&apos;s second job.
            </p>
          </div>
          <div className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-3">
            {AUDIENCE.map((c) => (
              <div key={c.title} className="scroll-reveal landing-panel rounded-card p-[34px]">
                <h3 className="mb-2.5 font-display text-[22px] font-semibold tracking-[-0.01em] text-foreground">
                  {c.title}
                </h3>
                <p className="text-pretty text-[15px] leading-[1.6] text-muted-foreground">
                  {c.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* 8. Start free */}
        <section id="start" className={SECTION}>
          <div className="max-w-[44rem]">
            <div className="scroll-reveal">
              <div className={EYEBROW}>Start free</div>
              <h2 className="mb-3.5 text-balance font-display text-[clamp(30px,4vw,46px)] font-semibold leading-[1.1] tracking-[-0.03em] text-foreground">
                Free while in early access
              </h2>
              <p className="mb-10 text-pretty text-[16.5px] leading-[1.65] text-muted-foreground">
                There is no card to enter and no trial to expire. Paid plans
                come later.
              </p>
            </div>
            <div className="flex flex-col">
              {STEPS.map((body, i) => (
                <div
                  key={i}
                  className={`scroll-reveal grid grid-cols-[2.2rem_1fr] gap-[18px] border-t border-border py-[22px] ${i === STEPS.length - 1 ? 'border-b' : ''}`}
                >
                  <span className="pt-[3px] font-mono text-[13px] font-medium text-quiet">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <p className="text-pretty text-[16.5px] leading-[1.65] text-secondary-foreground">
                    {body}
                  </p>
                </div>
              ))}
            </div>
            <Show when="signed-out">
              <Link
                href="/sign-up"
                className={`${CTA_PRIMARY} mt-9 px-[30px] py-[18px] text-[15.5px]`}
              >
                Start free
              </Link>
            </Show>
            <Show when="signed-in">
              <Link
                href="/dashboard"
                className={`${CTA_PRIMARY} mt-9 px-[30px] py-[18px] text-[15.5px]`}
              >
                Go to dashboard
              </Link>
            </Show>
          </div>
        </section>

        {/* Footer. The wordmark, year, and legal links are shared with the
            legal and status pages; the repository link is the landing page's
            own and rides along as the trailing slot. */}
        <div className="mt-32">
          <SiteFooter
            trailing={
              <a
                href={REPO_URL}
                className="inline-flex items-center gap-2 text-[13.5px] font-medium text-quiet transition-colors hover:text-foreground"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.95 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.85-2.35 4.7-4.57 4.95.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2z" />
                </svg>
                Repository
              </a>
            }
          />
        </div>
        </div>
      </div>
    </>
  )
}
