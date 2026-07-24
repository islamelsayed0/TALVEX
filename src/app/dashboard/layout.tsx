import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Wordmark } from "@/components/brand/wordmark";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { getActiveOrgViewer } from "@/lib/auth/org-viewer";

import { AskTalvexPill } from "./_shell/ask-talvex-pill";
import { DashboardNav } from "./_shell/dashboard-nav";
import { SettingsGear } from "./_shell/settings-gear";
import { navFor } from "./nav-items";

// Server component. The Clerk widgets and the nav pill are client components,
// rendered from here without making the shell a client component (CLAUDE.md:
// server components by default).
export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Architect ruling (docs/DECISIONS.md): a signed in session with no active
  // organization is redirected to org selection, never shown an error. This
  // runs before any child page, so nothing under /dashboard reaches the data
  // layer org-less; the MissingActiveOrgError in client.ts stays a backstop.
  const { orgId } = await auth();
  if (!orgId) {
    redirect("/select-org");
  }

  // Role drives which nav a person sees. isAdmin reads org_members.role (the
  // column RLS reads), never the token claim; see org-viewer.ts. This is a UI
  // affordance, not the boundary: RLS enforces the same answer on every query,
  // and admin pages call requireAdmin() to redirect a member who deep links in.
  const { isAdmin } = await getActiveOrgViewer();

  return (
    <div className="relative flex min-h-full flex-1 flex-col bg-background text-foreground">
      <header className="flex items-center justify-between gap-4 border-b border-border px-[22px] py-3.5">
        {/* Left: wordmark (no logo mark, per the design) and the org switcher,
            which is the org pill. */}
        <div className="flex min-w-0 flex-none items-center gap-3.5">
          <Link href="/dashboard">
            <Wordmark size="sm" />
          </Link>
          <div className="h-[22px] w-px flex-none bg-border" />
          {/* The org switcher is the org pill. The .glass wrapper paints the
              pill fill and gradient edge; the trigger inside is transparent
              (globals.css + clerk-appearance.ts). hidePersonal keeps every
              session inside an organization, which the tenancy model depends
              on: a personal workspace would produce a session with no org id,
              and every RLS policy reads that claim. */}
          <div className="glass inline-flex items-center rounded-full">
            <OrganizationSwitcher
              hidePersonal
              afterCreateOrganizationUrl="/dashboard"
              afterSelectOrganizationUrl="/dashboard"
            />
          </div>
        </div>

        {/* Center: the role aware nav pill. */}
        <DashboardNav items={navFor(isAdmin)} />

        {/* Right: settings (admin only), theme, and the account menu. */}
        <div className="flex flex-none items-center gap-2.5">
          {isAdmin ? <SettingsGear /> : null}
          <ThemeToggle className="h-9 w-9" />
          <UserButton />
        </div>
      </header>

      {children}

      {/* The floating AI entry point, admin only; it hides itself on Help. */}
      {isAdmin ? <AskTalvexPill /> : null}
    </div>
  );
}
