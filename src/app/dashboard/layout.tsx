import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import Link from "next/link";

// Server component. The Clerk widgets below are client components inside their
// own package, so they can be rendered from here without making this a client
// component (CLAUDE.md: server components by default).
export default function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
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
