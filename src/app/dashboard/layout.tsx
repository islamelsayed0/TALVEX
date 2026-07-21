import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";

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
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-gray-200 px-6 py-3 dark:border-gray-800">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-sm font-semibold tracking-tight">
            Talvex
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
        </div>
        <UserButton />
      </header>
      {children}
    </div>
  );
}
