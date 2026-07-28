import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { getActiveOrgViewer } from "@/lib/auth/org-viewer";
import { listKeyProviders } from "@/lib/db/api-keys";

import { DashboardShell } from "./_shell/dashboard-shell";
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
  const { orgId } = await auth();
  if (!orgId) {
    redirect("/select-org");
  }

  // Role drives which nav a person sees. isAdmin reads org_members.role (the
  // column RLS reads), never the token claim; see org-viewer.ts. This is a UI
  // affordance, not the boundary: RLS enforces the same answer on every query,
  // and admin pages call requireAdmin() to redirect a member who deep links in.
  const { isAdmin } = await getActiveOrgViewer();

  // The floating assistant is for everyone. It needs to know whether the org has
  // a provider key connected (otherwise it explains that instead of taking
  // input) and which providers to offer. Presence only; no key material.
  const keyProviders = await listKeyProviders();

  return (
    <DashboardShell
      isAdmin={isAdmin}
      navItems={navFor(isAdmin)}
      hasKey={keyProviders.length > 0}
      providers={toProviderOptions(keyProviders)}
    >
      {children}
    </DashboardShell>
  );
}
