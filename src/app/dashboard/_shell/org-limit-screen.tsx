/**
 * The clear screen the org count gate shows in place of a page (F13 PR 3,
 * docs/DECISIONS.md 2026-08-07). Rendered inside the shell on purpose: the
 * organization switcher in the header stays reachable, which is the way
 * back. Nothing about the org is deleted or locked for anyone else; this is
 * one person being over their own plan's allowance.
 */
export function OrgLimitScreen({
  allowance,
  position,
  total,
}: {
  allowance: number
  position: number
  total: number
}) {
  return (
    <main
      id="main-content"
      className="mx-auto w-full max-w-[600px] flex-1 animate-fade-up px-8 pt-[64px] pb-[72px]"
    >
      <h1 className="text-title text-foreground">
        This organization is outside your plan
      </h1>
      <p className="mt-3 text-[14.5px] leading-relaxed text-muted-foreground">
        Your plan includes {allowance === 1 ? 'one organization' : `${allowance} organizations`},
        and you belong to {total}. By join date this is number {position}, so it
        sits outside the allowance. Nothing here has been deleted, and other
        members of this organization are not affected; it is just not open to
        you while you are over the limit.
      </p>
      <p className="mt-3 text-[14.5px] leading-relaxed text-muted-foreground">
        To work here: switch to one of your included organizations with the
        switcher above, and either upgrade it to Business (up to 10
        organizations, in Settings, then Billing) or leave an organization you
        no longer need.
      </p>
      <p className="mt-6 text-[12px] text-quiet">
        Incident alerts for every organization keep running regardless. Limits
        never touch alerting.
      </p>
    </main>
  )
}
