import { OrganizationList } from "@clerk/nextjs";

import { AuthShell } from "@/components/auth-shell";
import { LogoMark } from "@/components/brand/logo-mark";

/**
 * Landing spot for signed in sessions with no active organization.
 *
 * Architect ruling (docs/DECISIONS.md): org-less sessions are redirected
 * here, never shown a hard error. The data layer refuses to run queries
 * without an org claim, so this page exists to make sure no signed in user
 * can be in the app without one for longer than it takes to pick or create
 * an organization. hidePersonal matches the switcher: personal workspaces
 * do not exist in this product.
 *
 * Styled after exploration 3c in docs/design/sign-in-explorations.html. The
 * page owns the heading, so the widget's own header is hidden here.
 */
export default function SelectOrgPage() {
  return (
    <AuthShell width={356}>
      <LogoMark size={46} />
      <h1 className="mt-[22px] text-title text-foreground">
        Choose an organization
      </h1>
      <p className="mt-3 max-w-[296px] text-sm leading-relaxed text-muted-foreground">
        Everything in Talvex belongs to an organization. Pick one or create
        your first.
      </p>
      <div className="org-list-shell mt-[30px] w-full">
        <OrganizationList
          hidePersonal
          afterCreateOrganizationUrl="/dashboard"
          afterSelectOrganizationUrl="/dashboard"
        />
      </div>
    </AuthShell>
  );
}
