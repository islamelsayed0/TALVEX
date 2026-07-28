import { requireAdmin } from '@/lib/auth/org-viewer'
import { UNKNOWN_MEMBER, resolveUserNames } from '@/lib/auth/user-names'
import { AI_PROVIDER_LABELS } from '@/lib/chat/providers-meta'
import { AI_PROVIDERS, listApiKeyEvents, listApiKeys } from '@/lib/db/api-keys'
import { getActiveOrganization, listOrgMembers } from '@/lib/db/queries'
import type { AiProvider, ApiKeyEventType } from '@/lib/db/types'

import { Card } from '../../_overview/ui'
import { formatUtc, primaryButton } from '../../monitors/ui'
import { FormError, ticketFieldClass } from '../../tickets/ui'
import { SettingsNav } from '../nav'
import { deleteApiKeyAction, saveApiKeyAction } from './actions'

export const metadata = { title: 'Settings — Talvex' }

const EVENT_LABEL: Record<ApiKeyEventType, string> = {
  added: 'Key added',
  replaced: 'Key replaced',
  deleted: 'Key removed',
}

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  technician: 'Technician',
  member: 'Member',
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

/**
 * Settings, restyled to the handoff. Admin only (requireAdmin). Real data:
 * the organization name, the team roster from org_members, and the BYOK AI
 * provider keys. The BYOK section is load bearing (add/replace with a provider
 * validation call, remove, and an append only activity trail) and is preserved
 * exactly, only restyled. The design's Plan / Region rows and the Notifications
 * and Quiet hours section have no schema, so they are omitted rather than faked.
 */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const asString = (v: string | string[] | undefined) =>
    typeof v === 'string' ? v : ''

  await requireAdmin()

  const [org, members, keys, events] = await Promise.all([
    getActiveOrganization(),
    listOrgMembers(),
    listApiKeys(),
    listApiKeyEvents(),
  ])
  const names = await resolveUserNames([
    ...members.map((m) => m.clerk_user_id),
    ...keys.map((k) => k.addedBy),
    ...events.map((e) => e.actor),
  ])
  const nameOf = (id: string) => names.get(id) ?? UNKNOWN_MEMBER

  const savedProvider = asString(sp.saved)
  const removedProvider = asString(sp.removed)
  const errorProvider = asString(sp.provider)
  const error = asString(sp.error)

  const banner = savedProvider
    ? `Saved. The ${AI_PROVIDER_LABELS[savedProvider as AiProvider] ?? savedProvider} key is ready.`
    : removedProvider
      ? `Removed the ${AI_PROVIDER_LABELS[removedProvider as AiProvider] ?? removedProvider} key.`
      : null

  const configured = new Set(keys.map((k) => k.provider))

  return (
    <main className="mx-auto w-full max-w-[780px] flex-1 animate-fade-up px-8 pt-[30px] pb-[72px]">
      <div className="mb-[22px]">
        <h1 className="text-title text-foreground">Settings</h1>
        <p className="mt-1.5 text-[14px] text-quiet">
          Manage your workspace, team and integrations.
        </p>
      </div>

      <SettingsNav />

      {banner ? (
        <Card className="mb-[18px] px-5 py-4 text-sm text-card-foreground">
          {banner}
        </Card>
      ) : null}

      <div className="flex flex-col gap-[18px]">
        {/* Organization */}
        <Card className="px-[22px] py-5">
          <h2 className="mb-4 text-base font-semibold text-foreground">
            Organization
          </h2>
          <div className="flex items-center justify-between gap-4">
            <span className="text-[13.5px] text-muted-foreground">Name</span>
            <span className="min-w-[220px] rounded-field border border-input bg-field px-3.5 py-2.5 text-sm text-field-text">
              {org?.name ?? 'Not synced yet'}
            </span>
          </div>
          {/* TODO: plan and region are not modeled (no schema); omitted, not faked. */}
        </Card>

        {/* Team members */}
        <Card className="px-[22px] py-5">
          <h2 className="mb-4 text-base font-semibold text-foreground">
            Team members
          </h2>
          <div className="flex flex-col">
            {members.map((m) => {
              const name = nameOf(m.clerk_user_id)
              return (
                <div
                  key={m.clerk_user_id}
                  className="flex items-center gap-3 border-t border-divider py-2.5 first:border-t-0"
                >
                  <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-accent-gradient text-[12px] font-semibold text-primary-foreground">
                    {initials(name)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                    {name}
                  </span>
                  <span className="flex-none text-[12.5px] text-muted-foreground">
                    {ROLE_LABEL[m.role] ?? m.role}
                  </span>
                </div>
              )
            })}
          </div>
        </Card>

        {/* AI providers (BYOK). Functionality preserved; only restyled. */}
        <Card className="px-[22px] py-5">
          <h2 className="text-base font-semibold text-foreground">AI providers</h2>
          <p className="mt-1 text-[12.5px] text-quiet">
            Bring your own key. Keys are encrypted, are never shown again after
            you save, and are used only on the server. One key per provider.
          </p>

          <div className="mt-4 flex flex-col">
            {AI_PROVIDERS.map((p) => {
              const key = keys.find((k) => k.provider === p)
              return (
                <div
                  key={p}
                  className="flex items-center justify-between gap-3 border-t border-divider py-3 first:border-t-0"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      className={`h-2 w-2 flex-none rounded-full ${key ? 'bg-status-up' : 'bg-quiet'}`}
                      aria-hidden
                    />
                    <span className="text-sm font-medium text-foreground">
                      {AI_PROVIDER_LABELS[p]}
                    </span>
                    <span className="truncate font-mono text-[12px] text-quiet">
                      {key ? `key ••••${key.keyLastFour}` : 'Not connected'}
                    </span>
                  </div>
                  {key ? (
                    <form action={deleteApiKeyAction}>
                      <input type="hidden" name="provider" value={p} />
                      <button
                        type="submit"
                        className="text-[13px] font-semibold text-accent-text"
                      >
                        Remove
                      </button>
                    </form>
                  ) : null}
                </div>
              )
            })}
          </div>

          {/* Add or replace a key. We validate with the provider before saving. */}
          <form
            action={saveApiKeyAction}
            className="mt-5 flex flex-col gap-3 border-t border-divider pt-5"
            autoComplete="off"
          >
            <span className="text-[13.5px] font-medium text-foreground">
              Add or replace a key
            </span>
            <FormError message={error || undefined} />
            <div className="flex flex-col gap-3 sm:flex-row">
              <label className="flex flex-1 flex-col gap-1.5">
                <span className="text-[12.5px] text-muted-foreground">Provider</span>
                <select
                  name="provider"
                  defaultValue={errorProvider || AI_PROVIDERS[0]}
                  className={`${ticketFieldClass} h-11 appearance-none`}
                >
                  {AI_PROVIDERS.map((p) => (
                    <option key={p} value={p}>
                      {AI_PROVIDER_LABELS[p]}
                      {configured.has(p) ? ' (replace)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-[2] flex-col gap-1.5">
                <span className="text-[12.5px] text-muted-foreground">Key</span>
                <input
                  name="key"
                  type="password"
                  required
                  autoComplete="off"
                  placeholder="Paste your provider key"
                  className={`${ticketFieldClass} h-11`}
                />
              </label>
            </div>
            <div>
              <button type="submit" className={primaryButton}>
                Validate and save
              </button>
            </div>
          </form>

          {/* The append only key trail. */}
          {events.length > 0 ? (
            <div className="mt-5 border-t border-divider pt-4">
              <span className="text-[13.5px] font-medium text-foreground">
                Key activity
              </span>
              <ol className="mt-2 flex flex-col gap-2">
                {events.map((e) => (
                  <li
                    key={e.id}
                    className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5"
                  >
                    <span className="text-[13px] text-muted-foreground">
                      {EVENT_LABEL[e.event_type as ApiKeyEventType]} ·{' '}
                      {AI_PROVIDER_LABELS[e.provider as AiProvider] ?? e.provider}{' '}
                      ending in {e.key_last_four}
                    </span>
                    <span className="font-mono text-[12px] text-quiet">
                      {nameOf(e.actor)}, {formatUtc(e.occurred_at)}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </Card>

        {/* Notifications and Quiet hours: no schema for preferences yet, so the
            section is omitted rather than shown with non-functional toggles. */}
      </div>
    </main>
  )
}
