import { describe, expect, it } from 'vitest'

import {
  AUDIT_ACTIONS,
  auditActionLabel,
  auditDetailSummary,
  auditTargetUserId,
} from '@/lib/db/audit'

// Display mapping for the audit screen (F12). These helpers are pure: they
// translate stored rows into sentences and can never widen what RLS lets a
// session read. What matters here is that every action in the migration 013
// vocabulary renders as human copy, and that malformed detail degrades to
// nothing instead of crashing the settings page.

describe('auditActionLabel', () => {
  it('gives every known action a human label distinct from the raw value', () => {
    for (const action of AUDIT_ACTIONS) {
      const label = auditActionLabel(action)
      expect(label).toBeTruthy()
      expect(label).not.toBe(action)
      // Prose rule: no hyphens in user facing copy.
      expect(label).not.toContain('-')
    }
  })

  it('falls back to the raw action for vocabulary this build does not know', () => {
    expect(auditActionLabel('article_published')).toBe('article_published')
  })
})

describe('auditDetailSummary', () => {
  it('describes a role change as a transition', () => {
    expect(
      auditDetailSummary({
        action: 'member_role_changed',
        detail: { target_user_id: 'user_1', old_role: 'member', new_role: 'admin' },
      }),
    ).toBe('member to admin')
  })

  it('describes key actions with provider and last four, never anything else', () => {
    const summary = auditDetailSummary({
      action: 'api_key_added',
      detail: { provider: 'anthropic', key_last_four: '1234' },
    })
    expect(summary).toBe('anthropic, ending 1234')
  })

  it('describes a monitor deletion by name', () => {
    expect(
      auditDetailSummary({ action: 'monitor_deleted', detail: { name: 'Website' } }),
    ).toBe('Website')
  })

  it('degrades to an empty string on missing or malformed detail', () => {
    expect(auditDetailSummary({ action: 'member_role_changed', detail: {} })).toBe('')
    expect(auditDetailSummary({ action: 'monitor_deleted', detail: null })).toBe('')
    expect(auditDetailSummary({ action: 'api_key_added', detail: [1, 2] })).toBe('')
    expect(auditDetailSummary({ action: 'monitor_deleted', detail: { name: 7 } })).toBe('')
    expect(auditDetailSummary({ action: 'something_else', detail: { a: 'b' } })).toBe('')
  })
})

describe('auditTargetUserId', () => {
  it('extracts the target of a role change', () => {
    expect(
      auditTargetUserId({
        action: 'member_role_changed',
        detail: { target_user_id: 'user_9' },
      }),
    ).toBe('user_9')
  })

  it('is null for actions without a target and for malformed detail', () => {
    expect(
      auditTargetUserId({ action: 'monitor_deleted', detail: { name: 'x' } }),
    ).toBeNull()
    expect(auditTargetUserId({ action: 'member_role_changed', detail: null })).toBeNull()
  })
})
