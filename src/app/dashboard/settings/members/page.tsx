import { requireAdmin } from '@/lib/auth/org-viewer'
import { resolveUserNames, UNKNOWN_MEMBER } from '@/lib/auth/user-names'
import { collectAudienceTags, listArticles } from '@/lib/db/articles'
import { listMembersWithTags } from '@/lib/db/member-tags'

import { Card } from '../../_overview/ui'
import { ghostButton } from '../../monitors/ui'
import { FormError, ticketFieldClass } from '../../tickets/ui'
import { SettingsNav } from '../nav'
import { updateMemberTagsAction } from './actions'

export const metadata = { title: 'Settings — Talvex' }

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  technician: 'Technician',
  member: 'Member',
}

/**
 * The Members settings tab (F14): the org member list with each member's
 * tags editable inline. Tags decide which help articles a member can read;
 * membership itself and roles stay managed in Clerk and synced by the
 * webhook, so this tab edits tags and nothing else.
 */
export default async function MembersSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireAdmin()

  const sp = await searchParams
  const asString = (v: string | string[] | undefined) =>
    typeof v === 'string' ? v : ''
  const error = asString(sp.error)
  const errorMember = asString(sp.member)
  const saved = asString(sp.saved) === '1'

  const [members, articles] = await Promise.all([
    listMembersWithTags(),
    listArticles(),
  ])
  const names = await resolveUserNames(members.map((m) => m.clerk_user_id))
  const tagSuggestions = [
    ...new Set([...collectAudienceTags(articles), ...members.flatMap((m) => m.tags)]),
  ].sort((a, b) => a.localeCompare(b))

  return (
    <main className="mx-auto w-full max-w-[780px] flex-1 animate-fade-up px-8 pt-[30px] pb-[72px]">
      <div className="mb-[22px]">
        <h1 className="text-title text-foreground">Settings</h1>
        <p className="mt-1.5 text-[14px] text-quiet">
          Manage your workspace, team and integrations.
        </p>
      </div>

      <SettingsNav />

      {saved ? (
        <Card className="mb-[18px] px-5 py-4 text-sm text-card-foreground">
          Saved. Article visibility follows the new tags right away.
        </Card>
      ) : null}

      <Card className="px-[22px] py-5">
        <h2 className="text-base font-semibold text-foreground">Members</h2>
        <p className="mt-1 text-[12.5px] text-quiet">
          Tags control which help articles a member can see: an article
          reaches a member when its audience is empty or shares a tag with
          them. Membership and roles are managed in Clerk, not here.
          {tagSuggestions.length > 0
            ? ` Tags in use: ${tagSuggestions.join(', ')}.`
            : ''}
        </p>

        {members.length === 0 ? (
          <p className="mt-4 border-t border-divider pt-4 text-[13px] text-quiet">
            No members synced yet.
          </p>
        ) : (
          <div className="mt-3">
            {members.map((m) => (
              <div
                key={m.clerk_user_id}
                className="border-t border-divider py-3.5"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-[13.5px] font-medium text-foreground">
                    {names.get(m.clerk_user_id) ?? UNKNOWN_MEMBER}
                  </span>
                  <span className="flex-none text-[12px] text-quiet">
                    {ROLE_LABEL[m.role] ?? m.role}
                  </span>
                </div>
                {errorMember === m.clerk_user_id ? (
                  <div className="mt-2">
                    <FormError message={error || undefined} />
                  </div>
                ) : null}
                <form
                  action={updateMemberTagsAction}
                  className="mt-2 flex items-center gap-2"
                >
                  <input
                    type="hidden"
                    name="clerk_user_id"
                    value={m.clerk_user_id}
                  />
                  <input
                    name="tags"
                    defaultValue={m.tags.join(', ')}
                    placeholder="No tags. Comma separated, e.g. onsite, finance"
                    className={`${ticketFieldClass} h-10 flex-1`}
                  />
                  <button
                    type="submit"
                    className={`${ghostButton} h-10 flex-none px-3.5 py-0`}
                  >
                    Save
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}
      </Card>
    </main>
  )
}
