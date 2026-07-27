import { Show } from '@clerk/nextjs'
import Image from 'next/image'
import Link from 'next/link'

import { HeroBackground } from './_landing/hero-background'

export const metadata = {
  title: 'Talvex — one calm place for your systems',
  description:
    'Uptime monitoring, incidents, tickets and AI support in one system, for the small offices that keep it all running on one person.',
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

const ALERTS = [
  {
    title: 'Email',
    body: 'Every time a system changes state, the moment it happens.',
  },
  {
    title: 'Discord',
    body: 'The same alert in your team channel, so whoever is closest sees it first.',
  },
  {
    title: 'Recovery alerts',
    body: 'You hear when it comes back, not just when it breaks, so you know it is handled.',
  },
]

const BUILT = [
  'Tenant isolation is enforced at the database with Postgres row level security, not in application code.',
  'The isolation suite runs against a real Postgres in CI, and it is verified able to fail, so a green run means something.',
  'Migrations replay from zero on every run, so the schema in CI is the schema you get.',
  'Bring your own AI provider key. Keys are stored encrypted, and there is no markup on tokens you already pay for.',
]

const AUDIENCE = [
  {
    title: 'Medical offices',
    body: 'Booking software, the practice management system and the front desk machines stay watched, and staff report a problem without needing to know what broke.',
  },
  {
    title: 'Law offices',
    body: "Case systems, mail and file servers in one view, with your firm's data separated at the database from every other firm's.",
  },
  {
    title: 'Small IT & consultants',
    body: 'Run several client offices from one login, each isolated, without stitching five tools together.',
  },
]

const STEPS = [
  'Sign in with Google. Nothing separate to set up.',
  'Add your first monitor in about a minute. Paste a URL, choose how often to check it.',
  'Nothing to install. No server to run and no agent on your machines.',
]

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
          <div className="text-center">
            <h1 className="font-display text-[clamp(64px,11vw,132px)] font-normal leading-[1.04] tracking-[-0.028em] text-foreground">
              One <span className="text-accent-text">calm</span> place
            </h1>
            <p className="mx-auto mt-4 max-w-[34rem] text-pretty text-[18px] leading-[1.7] text-muted-foreground">
              Uptime monitoring, incidents, tickets and AI support in one system,
              for the small offices that keep it all running on one person.
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

        {/* 2. Product shot */}
        <section id="product" className="mx-auto max-w-[1240px] px-8 pt-16">
          <div className="landing-frame rounded-[22px] p-2.5">
            <div className="flex items-center gap-2 px-2.5 pb-3 pt-1.5">
              <span className="h-[9px] w-[9px] rounded-full bg-white/[0.14]" />
              <span className="h-[9px] w-[9px] rounded-full bg-white/[0.14]" />
              <span className="h-[9px] w-[9px] rounded-full bg-white/[0.14]" />
              <span className="ml-2 font-mono text-[12px] text-quiet">
                talvex.app/dashboard
              </span>
            </div>
            <div className="relative aspect-[1918/1202] overflow-hidden rounded-tile">
              <Image
                src="/landing/overview-shot.png"
                alt="The Talvex overview: monitor status, open incidents, ticket queue and response times on one screen"
                fill
                priority
                sizes="(max-width: 1240px) 100vw, 1240px"
                className="object-cover object-top"
              />
            </div>
          </div>
          <p className="mx-auto mt-5 max-w-[40rem] text-pretty text-center text-[15px] leading-[1.65] text-quiet">
            The overview, as it ships. Is anything down, is anything on fire, what
            needs me today.
          </p>

          <div className="mt-24 grid grid-cols-1 items-center gap-14 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
            <div>
              <h2 className="text-balance font-display text-[clamp(26px,3.2vw,38px)] font-semibold leading-[1.12] tracking-[-0.028em] text-foreground">
                And this is what your staff sees
              </h2>
              <p className="mt-[18px] text-pretty text-[16.5px] leading-[1.65] text-muted-foreground">
                One screen, one obvious action. They describe what is going on in
                plain words, or send a request straight to you. No jargon and
                nothing to figure out first.
              </p>
              <p className="mt-4 text-pretty text-[16.5px] leading-[1.65] text-muted-foreground">
                When something is already broken, they see it there before they
                ask, which is three emails you never get.
              </p>
            </div>
            <div className="landing-frame rounded-card p-[9px]">
              <div className="flex items-center gap-2 px-2.5 pb-2.5 pt-1.5">
                <span className="h-2 w-2 rounded-full bg-white/[0.14]" />
                <span className="h-2 w-2 rounded-full bg-white/[0.14]" />
                <span className="h-2 w-2 rounded-full bg-white/[0.14]" />
                <span className="ml-2 font-mono text-[11.5px] text-quiet">
                  talvex.app/help
                </span>
              </div>
              <div className="relative aspect-[1204/982] overflow-hidden rounded-[13px]">
                <Image
                  src="/landing/staff-help-shot.png"
                  alt="The staff help screen: one input to describe the problem, a notice that the booking site is already known to be down, and buttons for a new request"
                  fill
                  sizes="(max-width: 768px) 100vw, 620px"
                  className="object-cover object-top"
                />
              </div>
            </div>
          </div>
        </section>

        {/* 3. The problem */}
        <section id="problem" className={SECTION}>
          <div className="max-w-[44rem]">
            <div className={EYEBROW}>The problem</div>
            <p className="text-pretty font-display text-[clamp(21px,2.4vw,27px)] font-normal leading-[1.6] tracking-[-0.012em] text-ghost-text">
              The printer is down. Three people have emailed you about it, one of
              them walked over to your desk, and the outage is in one tool while
              the emails are in another. By the time you have pieced it together,
              someone asks you for a status update.
            </p>
            <p className="mt-7 text-pretty font-display text-[clamp(21px,2.4vw,27px)] font-normal leading-[1.6] tracking-[-0.012em] text-ghost-text">
              Talvex keeps them together. The outage and the requests it caused
              sit in one system, so the ticket already knows what is broken and
              you are not the integration between two tools.
            </p>
          </div>
        </section>

        {/* 4. What Talvex is */}
        <section id="what" className={SECTION}>
          <div className="grid grid-cols-1 items-start gap-14 md:grid-cols-[17rem_minmax(0,1fr)]">
            <h2 className="text-balance font-display text-[clamp(26px,3.2vw,38px)] font-semibold leading-[1.12] tracking-[-0.028em] text-foreground">
              What Talvex is
            </h2>
            <div className="max-w-[44rem]">
              <p className="text-pretty font-display text-[clamp(19px,2vw,23px)] font-normal leading-[1.62] tracking-[-0.01em] text-ghost-text">
                Talvex is where your office goes when something breaks. It watches
                the systems you depend on, opens a ticket the moment one fails,
                and gives your staff one screen to ask for help without needing to
                know what a server is or who to email.
              </p>
              <div className="landing-panel mt-9 rounded-card px-8 py-[30px]">
                <div className="mb-3.5 font-mono text-[12px] font-medium uppercase tracking-[0.08em] text-quiet">
                  The rule
                </div>
                <p className="text-pretty text-[16.5px] leading-[1.65] text-secondary-foreground">
                  The rule for every screen is the same: someone who does not work
                  in IT should be able to get help in one screen, with one obvious
                  action and no jargon.
                </p>
                <p className="mt-4 text-[16.5px] font-medium leading-[1.65] text-foreground">
                  If a screen fails that, it gets rebuilt.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* 5. How you find out */}
        <section id="alerts" className={SECTION}>
          <div className="max-w-[44rem]">
            <div className={EYEBROW}>How you find out</div>
            <h2 className="mb-4 text-balance font-display text-[clamp(30px,4vw,46px)] font-semibold leading-[1.1] tracking-[-0.03em] text-foreground">
              You will know before your staff tell you
            </h2>
            <p className="text-pretty text-[16.5px] leading-[1.65] text-muted-foreground">
              A failed check opens an incident and reaches you on the channel you
              chose, with the ticket already attached to it.
            </p>
          </div>
          <div className="mt-13 grid grid-cols-1 border-y border-border sm:grid-cols-3">
            {ALERTS.map((a, i) => (
              <div
                key={a.title}
                className={`border-border py-7 sm:border-t-0 ${i > 0 ? 'border-t sm:border-l sm:pl-8' : ''} ${i < ALERTS.length - 1 ? 'sm:pr-8' : ''}`}
              >
                <div className="mb-2 text-[16px] font-semibold text-foreground">
                  {a.title}
                </div>
                <p className="text-pretty text-[15px] leading-[1.6] text-muted-foreground">
                  {a.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* 6. How it's built */}
        <section id="built" className={SECTION}>
          <div className="max-w-[44rem]">
            <div className={EYEBROW}>How it&apos;s built</div>
            <h2 className="mb-10 text-balance font-display text-[clamp(30px,4vw,46px)] font-semibold leading-[1.1] tracking-[-0.03em] text-foreground">
              Built to be checked
            </h2>
            <div className="flex flex-col">
              {BUILT.map((body, i) => (
                <div
                  key={i}
                  className={`grid grid-cols-[2.2rem_1fr] gap-[18px] border-t border-border py-[22px] ${i === BUILT.length - 1 ? 'border-b' : ''}`}
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
          </div>
        </section>

        {/* 7. Who it's for */}
        <section id="who" className={SECTION}>
          <div className="max-w-[44rem]">
            <div className={EYEBROW}>Who it&apos;s for</div>
            <h2 className="text-balance font-display text-[clamp(30px,4vw,46px)] font-semibold leading-[1.1] tracking-[-0.03em] text-foreground">
              Small offices, not enterprise sprawl
            </h2>
            <p className="mt-[18px] text-pretty text-[16.5px] leading-[1.65] text-muted-foreground">
              Built for small and mid sized businesses where IT is one person, or
              one person&apos;s second job.
            </p>
          </div>
          <div className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-3">
            {AUDIENCE.map((c) => (
              <div key={c.title} className="landing-panel rounded-card p-[34px]">
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
            <div className={EYEBROW}>Start free</div>
            <h2 className="mb-3.5 text-balance font-display text-[clamp(30px,4vw,46px)] font-semibold leading-[1.1] tracking-[-0.03em] text-foreground">
              Free while in early access
            </h2>
            <p className="mb-10 text-pretty text-[16.5px] leading-[1.65] text-muted-foreground">
              There is no card to enter and no trial to expire. Paid plans come
              later.
            </p>
            <div className="flex flex-col">
              {STEPS.map((body, i) => (
                <div
                  key={i}
                  className={`grid grid-cols-[2.2rem_1fr] gap-[18px] border-t border-border py-[22px] ${i === STEPS.length - 1 ? 'border-b' : ''}`}
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

        {/* Footer */}
        <footer className="mt-32 border-t border-border py-[44px] pb-14">
          <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-[18px] px-8">
            <div className="flex flex-wrap items-center gap-4">
              <span className="font-display text-[18px] font-semibold text-secondary-foreground">
                Talvex
              </span>
              <p className="text-[13px] text-quiet">© 2026 Talvex</p>
            </div>
            <a
              href="https://github.com"
              className="inline-flex items-center gap-2 text-[13.5px] font-medium text-quiet transition-colors hover:text-foreground"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.95 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.85-2.35 4.7-4.57 4.95.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2z" />
              </svg>
              Repository
            </a>
          </div>
        </footer>
      </div>
    </>
  )
}
