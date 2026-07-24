import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";

import { LogoMark } from "@/components/brand/logo-mark";
import { Wordmark } from "@/components/brand/wordmark";
import { ThemeToggle } from "@/components/theme/theme-toggle";

// Server component. The Clerk widgets below are client components inside their
// own package, so they can be rendered from here without making this a client
// component (CLAUDE.md: server components by default).
export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Architect ruling (docs/DECISIONS.md): a signed in session with no active
  // organization is redirected to org selection, never shown an error. This
  // runs before any child page, so nothing under /dashboard can reach the
  // data layer org-less; the MissingActiveOrgError in client.ts stays a
  // backstop that should never fire from here.
  const { orgId } = await auth();
  if (!orgId) {
    redirect("/select-org");
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border px-6 py-3">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2.5">
            <LogoMark size={28} />
            <Wordmark size="sm" />
          </Link>
          {/* Org switcher. hidePersonal keeps every session inside an
              organization, which is what the tenancy model depends on: a
              personal workspace would produce a session with no org id and
              every RLS policy in Task 4 reads that claim. */}
          <OrganizationSwitcher
            hidePersonal
            afterCreateOrganizationUrl="/dashboard"
            afterSelectOrganizationUrl="/dashboard"
          />
          <nav className="flex items-center gap-1 text-sm">
            <Link
              href="/dashboard"
              className="rounded-button px-3 py-1.5 text-muted-foreground transition-colors hover:bg-(--ghost-hover-bg) hover:text-foreground"
            >
              Overview
            </Link>
            <Link
              href="/dashboard/monitors"
              className="rounded-button px-3 py-1.5 text-muted-foreground transition-colors hover:bg-(--ghost-hover-bg) hover:text-foreground"
            >
              Monitors
            </Link>
            <Link
              href="/dashboard/incidents"
              className="rounded-button px-3 py-1.5 text-muted-foreground transition-colors hover:bg-(--ghost-hover-bg) hover:text-foreground"
            >
              Incidents
            </Link>
            <Link
              href="/dashboard/tickets"
              className="rounded-button px-3 py-1.5 text-muted-foreground transition-colors hover:bg-(--ghost-hover-bg) hover:text-foreground"
            >
              Tickets
            </Link>
            {/* Chat is reachable from the nav for returning to past
                conversations (Task 5 addendum); the funnel still begins at
                Get help. */}
            <Link
              href="/dashboard/chat"
              className="rounded-button px-3 py-1.5 text-muted-foreground transition-colors hover:bg-(--ghost-hover-bg) hover:text-foreground"
            >
              Chat
            </Link>
            <Link
              href="/dashboard/settings/api-keys"
              className="rounded-button px-3 py-1.5 text-muted-foreground transition-colors hover:bg-(--ghost-hover-bg) hover:text-foreground"
            >
              Settings
            </Link>
            {/* Get help is the one accent item in the nav on purpose: it is
                the product's primary ask (ruling 4), and accent means
                primary action, never status. */}
            <Link
              href="/dashboard/get-help"
              className="rounded-button px-3 py-1.5 font-medium whitespace-nowrap text-accent-text transition-colors hover:bg-(--accent-hover-bg)"
            >
              Get help
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle className="h-9 w-9" />
          <UserButton />
        </div>
      </header>
      {children}
    </div>
  );
}
