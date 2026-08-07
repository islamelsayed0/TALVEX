import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { getActiveOrgViewer } from "@/lib/auth/org-viewer";
import { chatEntryMode } from "@/lib/billing/managed-ai";
import { checkOrgAccess } from "@/lib/billing/org-access";
import { listKeyProviders } from "@/lib/db/api-keys";
import { readSweepHeartbeat } from "@/lib/db/heartbeat";
import { sweepBannerCopy } from "@/lib/monitoring/heartbeat";

import { DashboardShell } from "./_shell/dashboard-shell";
import { OrgLimitScreen } from "./_shell/org-limit-screen";
import { toProviderOptions } from "./chat/ui";
import { navFor } from "./nav-items";

// Server component: fetches role and provider presence, then hands them to the
// client shell (the sidebar carries collapse and overlay state, so it is the
// client boundary). CLAUDE.md: server components by default.
export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Architect ruling (docs/DECISIONS.md): a signed in session with no active
  // organization is redirected to org selection, never shown an error. This
  // runs before any child page, so nothing under /dashboard reaches the data
  // layer org-less; the MissingActiveOrgError in client.ts stays a backstop.
  const { userId, orgId } = await auth();
  if (!userId || !orgId) {
    redirect("/select-org");
  }

  // The org count gate (F13 PR 3, docs/DECISIONS.md 2026-08-07): Clerk's
  // hosted widgets create orgs with no server side hook before the fact, so
  // the plan's organization allowance is enforced here, with a clear screen
  // rendered in place of the page. Per person, oldest memberships first; see
  // org-access.ts for the reasoning. This is PACKAGING enforcement, not a
  // security boundary: the viewer is a legitimate member of the org and the
  // page's own server render may still execute alongside this layout; RLS
  // remains the boundary for what any session can read. The screen gates
  // use of the product, which is what a plan limit is.
  const orgAccess = await checkOrgAccess(userId, orgId);

  // Role drives which nav a person sees. isAdmin reads org_members.role (the
  // column RLS reads), never the token claim; see org-viewer.ts. This is a UI
  // affordance, not the boundary: RLS enforces the same answer on every query,
  // and admin pages call requireAdmin() to redirect a member who deep links in.
  const { isAdmin } = await getActiveOrgViewer();

  // The floating assistant is for everyone. It needs to know whether the org
  // has a provider key connected, and failing that whether the plan's managed
  // answers are open, spent for the month, or absent (F13 PR 3), so it can
  // take input, degrade to the ticket door, or explain. Presence only; no
  // key material.
  const keyProviders = await listKeyProviders();
  const chatEntry = await chatEntryMode(orgId, keyProviders.length > 0);

  // The stale sweep banner lives in the layout, not on the Overview page, and
  // that placement is the point: when monitoring dies, a Monitors table full of
  // green "Up" rows is exactly as misleading as the Overview claiming all is
  // well. Whichever page an admin is on should say the data is stale.
  //
  // Admins only. A member cannot enable a scheduler or check an environment
  // variable, so for them this is alarm without a remedy.
  const sweepBanner = isAdmin ? sweepBannerCopy(await readSweepHeartbeat()) : null;

  return (
    <DashboardShell
      isAdmin={isAdmin}
      navItems={navFor(isAdmin)}
      chatEntry={orgAccess.allowed ? chatEntry : "none"}
      providers={toProviderOptions(keyProviders)}
      sweepBanner={sweepBanner}
    >
      {orgAccess.allowed ? (
        children
      ) : (
        <OrgLimitScreen
          allowance={orgAccess.allowance}
          position={orgAccess.position}
          total={orgAccess.total}
        />
      )}
    </DashboardShell>
  );
}
