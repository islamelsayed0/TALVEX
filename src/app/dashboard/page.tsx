import { auth } from "@clerk/nextjs/server";

// Protected placeholder. Empty on purpose: Phase 1 fills it with monitors,
// incidents, and tickets, and Task 7 gives it a real look.
export default async function DashboardPage() {
  const { userId, orgId, orgRole } = await auth();

  return (
    <main className="flex flex-1 flex-col gap-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Signed in and scoped to an organization. Nothing to show yet.
        </p>
      </div>

      {/* These three values are the tenancy signal the whole platform rests on.
          orgId is the claim every RLS policy in Task 4 filters on, so showing
          it here makes a broken session obvious immediately rather than at
          query time. Identifiers only, never tokens. */}
      <dl className="grid max-w-md grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-gray-500">User</dt>
        <dd className="font-mono text-xs">{userId}</dd>
        <dt className="text-gray-500">Organization</dt>
        <dd className="font-mono text-xs">
          {orgId ?? "none active"}
        </dd>
        <dt className="text-gray-500">Role</dt>
        <dd className="font-mono text-xs">{orgRole ?? "none"}</dd>
      </dl>

      {!orgId && (
        <p className="max-w-md rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          No organization is active. Create or select one in the switcher above.
          Tenant data in Task 4 is keyed on the organization, so requests
          without one cannot be scoped.
        </p>
      )}
    </main>
  );
}
