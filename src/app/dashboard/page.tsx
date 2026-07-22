import { auth } from "@clerk/nextjs/server";

import { getActiveOrganization, listOrgMembers } from "@/lib/db/queries";

// Protected placeholder. Empty on purpose: Phase 1 fills it with monitors,
// incidents, and tickets, and Task 7 gives it a real look.
//
// The org row and member list come from Postgres through the org scoped
// client, which makes this page the live proof of the whole Task 4 chain:
// Clerk token -> Supabase third party auth -> RLS -> rows. If the webhook
// has not synced this org yet, the org shows as "not synced" rather than
// erroring; the layout already guaranteed an active org exists.
export default async function DashboardPage() {
  const { userId, orgId, orgRole } = await auth();
  const [organization, members] = await Promise.all([
    getActiveOrganization(),
    listOrgMembers(),
  ]);

  return (
    <main className="flex flex-1 flex-col gap-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Signed in and scoped to an organization. Nothing to show yet.
        </p>
      </div>

      {/* Identifiers only, never tokens. */}
      <dl className="grid max-w-md grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-gray-500">User</dt>
        <dd className="font-mono text-xs">{userId}</dd>
        <dt className="text-gray-500">Organization</dt>
        <dd className="font-mono text-xs">{orgId}</dd>
        <dt className="text-gray-500">Role</dt>
        <dd className="font-mono text-xs">{orgRole ?? "none"}</dd>
        <dt className="text-gray-500">Database row</dt>
        <dd className="font-mono text-xs">
          {organization
            ? `${organization.name} (synced)`
            : "not synced yet - webhook pending"}
        </dd>
        <dt className="text-gray-500">Members synced</dt>
        <dd className="font-mono text-xs">{members.length}</dd>
      </dl>
    </main>
  );
}
