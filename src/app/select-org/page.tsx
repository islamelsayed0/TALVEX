import { OrganizationList } from "@clerk/nextjs";

/**
 * Landing spot for signed in sessions with no active organization.
 *
 * Architect ruling (docs/DECISIONS.md): org-less sessions are redirected
 * here, never shown a hard error. The data layer refuses to run queries
 * without an org claim, so this page exists to make sure no signed in user
 * can be in the app without one for longer than it takes to pick or create
 * an organization. hidePersonal matches the switcher: personal workspaces
 * do not exist in this product.
 */
export default function SelectOrgPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          Choose an organization
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Everything in Talvex belongs to an organization. Pick one or create
          your first.
        </p>
      </div>
      <OrganizationList
        hidePersonal
        afterCreateOrganizationUrl="/dashboard"
        afterSelectOrganizationUrl="/dashboard"
      />
    </main>
  );
}
