import { auth } from "@clerk/nextjs/server";

import { getActiveOrganization, listOrgMembers } from "@/lib/db/queries";

// Protected placeholder. Empty on purpose: Phase 1 fills it with monitors,
// incidents, and tickets; Task 7 gave it the design system it inherits from.
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
        <h1 className="text-title text-foreground">Dashboard</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Signed in and scoped to an organization. Nothing to show yet.
        </p>
      </div>

      {/* Identifiers only, never tokens. */}
      <dl className="grid max-w-md grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 rounded-button border border-border bg-card p-5 text-sm text-card-foreground">
        <dt className="text-quiet">User</dt>
        <dd className="font-mono text-xs">{userId}</dd>
        <dt className="text-quiet">Organization</dt>
        <dd className="font-mono text-xs">{orgId}</dd>
        <dt className="text-quiet">Role</dt>
        <dd className="font-mono text-xs">{orgRole ?? "none"}</dd>
        <dt className="text-quiet">Database row</dt>
        <dd className="font-mono text-xs">
          {organization
            ? `${organization.name} (synced)`
            : "not synced yet, webhook pending"}
        </dd>
        <dt className="text-quiet">Members synced</dt>
        <dd className="font-mono text-xs">{members.length}</dd>
      </dl>
    </main>
  );
}
