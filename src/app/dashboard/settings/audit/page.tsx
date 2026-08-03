import { requireAdmin } from '@/lib/auth/org-viewer'
import { resolveUserNames, UNKNOWN_MEMBER } from '@/lib/auth/user-names'
import {
  auditActionLabel,
  auditDetailSummary,
  auditTargetUserId,
  listAuditLog,
} from '@/lib/db/audit'

import { Card } from '../../_overview/ui'
import { formatUtc } from '../../monitors/ui'
import { SettingsNav } from '../nav'

export const metadata = { title: 'Settings — Talvex' }

/**
 * The audit log (F12), read only by construction: the database triggers are
 * the only writers, so this screen is a window, never an editor. Admin only
 * exactly like the other settings tabs (requireAdmin), and the data layer
 * runs under the caller's own RLS besides, which already scopes the log to
 * this org and to admins.
 */
export default async function AuditSettingsPage() {
  await requireAdmin()

  const entries = await listAuditLog()
  const names = await resolveUserNames([
    ...entries.map((e) => e.actor),
    ...entries.map((e) => auditTargetUserId(e)),
  ])
  const nameOf = (id: string | null) =>
    id ? (names.get(id) ?? UNKNOWN_MEMBER) : 'System'

  return (
    <main id="main-content" className="mx-auto w-full max-w-[780px] flex-1 animate-fade-up px-8 pt-[30px] pb-[72px]">
      <div className="mb-[22px]">
        <h1 className="text-title text-foreground">Settings</h1>
        <p className="mt-1.5 text-[14px] text-quiet">
          Manage your workspace, team and integrations.
        </p>
      </div>

      <SettingsNav />

      <Card className="px-[22px] py-5">
        <h2 className="text-base font-semibold text-foreground">Audit log</h2>
        <p className="mt-1 text-[12.5px] text-quiet">
          Sensitive actions in this organization: role changes, AI provider
          key changes and deletions. Recorded by the database and never
          editable, including by admins.
        </p>

        {entries.length === 0 ? (
          <p className="mt-4 border-t border-divider pt-4 text-[13px] text-quiet">
            Nothing recorded yet. Sensitive actions will show up here as they
            happen.
          </p>
        ) : (
          <ul className="mt-3">
            {entries.map((entry) => {
              const summary = auditDetailSummary(entry)
              const target = auditTargetUserId(entry)
              return (
                <li
                  key={entry.id}
                  className="flex items-baseline justify-between gap-4 border-t border-divider py-2.5"
                >
                  <div className="min-w-0">
                    <span className="block text-[13.5px] font-medium text-foreground">
                      {auditActionLabel(entry.action)}
                      {target ? ` — ${nameOf(target)}` : ''}
                    </span>
                    <span className="mt-0.5 block text-[12.5px] text-muted-foreground">
                      {summary ? `${summary} · ` : ''}
                      by {nameOf(entry.actor)}
                    </span>
                  </div>
                  <span className="flex-none font-mono text-[12px] text-quiet">
                    {formatUtc(entry.occurred_at)}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <p className="mt-[18px] text-[12px] text-quiet">
        Showing the most recent 200 entries.
      </p>
    </main>
  )
}
