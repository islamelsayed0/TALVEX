import { createOrgScopedClient } from './client'
import type { AuditAction, AuditEntry } from './types'

/**
 * Typed data layer for the audit log (BRD F12, CLAUDE.md code rule 7). The
 * log is written ONLY by SECURITY DEFINER triggers in the database (migration
 * 013); nothing in the application can write it, including this module. RLS
 * makes reading admin only and org scoped before any code here sees a row, so
 * for a member every query below simply returns nothing.
 *
 * The pure helpers translate stored rows into the sentences the audit screen
 * shows. They are display only: a wrong label can misdescribe an action but
 * can never change what the database recorded or who may read it.
 */

/** Everything migration 013 allows in audit_log.action, for the unit tests
 * and the screen. Extending the vocabulary means a migration plus this list
 * plus a label below, and the tests fail loudly when the three drift. */
export const AUDIT_ACTIONS: readonly AuditAction[] = [
  'member_role_changed',
  'api_key_added',
  'api_key_replaced',
  'api_key_deleted',
  'monitor_deleted',
]

const ACTION_LABELS: Record<AuditAction, string> = {
  member_role_changed: 'Member role changed',
  api_key_added: 'AI provider key added',
  api_key_replaced: 'AI provider key replaced',
  api_key_deleted: 'AI provider key deleted',
  monitor_deleted: 'Monitor deleted',
}

/** Human label for an action. Unknown values (a newer vocabulary than this
 * build, mid deploy) fall back to the raw action rather than crashing. */
export function auditActionLabel(action: string): string {
  return ACTION_LABELS[action as AuditAction] ?? action
}

/** A detail value when it is a plain string, else null. The detail column is
 * jsonb and this layer never trusts its shape blindly. */
function detailString(detail: AuditEntry['detail'], key: string): string | null {
  if (typeof detail !== 'object' || detail === null || Array.isArray(detail)) {
    return null
  }
  const value = detail[key]
  return typeof value === 'string' ? value : null
}

/**
 * The one line of supporting facts under an action label, built from the
 * structured detail the trigger recorded. Falls back to nothing rather than
 * rendering raw JSON at a user.
 */
export function auditDetailSummary(entry: {
  action: string
  detail: AuditEntry['detail']
}): string {
  switch (entry.action) {
    case 'member_role_changed': {
      const oldRole = detailString(entry.detail, 'old_role')
      const newRole = detailString(entry.detail, 'new_role')
      return oldRole && newRole ? `${oldRole} to ${newRole}` : ''
    }
    case 'api_key_added':
    case 'api_key_replaced':
    case 'api_key_deleted': {
      const provider = detailString(entry.detail, 'provider')
      const lastFour = detailString(entry.detail, 'key_last_four')
      if (!provider) return ''
      return lastFour ? `${provider}, ending ${lastFour}` : provider
    }
    case 'monitor_deleted':
      return detailString(entry.detail, 'name') ?? ''
    default:
      return ''
  }
}

/** The Clerk user id of the person an action was done TO, when the action has
 * a target (today: role changes). The screen resolves it to a name. */
export function auditTargetUserId(entry: {
  action: string
  detail: AuditEntry['detail']
}): string | null {
  if (entry.action !== 'member_role_changed') return null
  return detailString(entry.detail, 'target_user_id')
}

/**
 * The most recent audit entries this session may see: for an org admin their
 * org's log newest first, for anyone else nothing, both enforced by RLS.
 */
export async function listAuditLog(limit = 200): Promise<AuditEntry[]> {
  const { client } = await createOrgScopedClient()
  const { data, error } = await client
    .from('audit_log')
    .select()
    .order('occurred_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data
}
