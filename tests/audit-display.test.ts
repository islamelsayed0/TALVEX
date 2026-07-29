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
    expect(auditActionLabel('billing_plan_changed')).toBe('billing_plan_changed')
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

  it('describes article actions by title, never body content', () => {
    for (const action of [
      'article_created',
      'article_published',
      'article_unpublished',
      'article_deleted',
    ]) {
      expect(
        auditDetailSummary({ action, detail: { title: 'Printer guide' } }),
      ).toBe('Printer guide')
    }
  })

  it('describes an article update with its changed field names', () => {
    expect(
      auditDetailSummary({
        action: 'article_updated',
        detail: { title: 'Printer guide', changed: ['title', 'audience_tags'] },
      }),
    ).toBe('Printer guide (title, audience tags)')
  })

  it('describes a tag change by the tags as assigned, or their removal', () => {
    expect(
      auditDetailSummary({
        action: 'member_tags_changed',
        detail: { target_user_id: 'user_1', tags: ['onsite', 'finance'] },
      }),
    ).toBe('onsite, finance')
    expect(
      auditDetailSummary({
        action: 'member_tags_changed',
        detail: { target_user_id: 'user_1', tags: [] },
      }),
    ).toBe('all tags removed')
  })

  it('describes settings changes by changed field names, never values', () => {
    expect(
      auditDetailSummary({
        action: 'status_page_enabled',
        detail: { changed: ['status_page_enabled', 'status_page_slug'] },
      }),
    ).toBe('status page enabled, status page slug')
    expect(
      auditDetailSummary({
        action: 'timezone_changed',
        detail: { changed: ['timezone'] },
      }),
    ).toBe('timezone')
    expect(
      auditDetailSummary({
        action: 'notification_settings_changed',
        detail: { changed: ['discord_webhook', 'email_on_open'] },
      }),
    ).toBe('discord webhook, email on open')
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

  it('extracts the target of a tag change', () => {
    expect(
      auditTargetUserId({
        action: 'member_tags_changed',
        detail: { target_user_id: 'user_3', tags: [] },
      }),
    ).toBe('user_3')
  })

  it('is null for actions without a target and for malformed detail', () => {
    expect(
      auditTargetUserId({ action: 'monitor_deleted', detail: { name: 'x' } }),
    ).toBeNull()
    expect(auditTargetUserId({ action: 'member_role_changed', detail: null })).toBeNull()
  })
})
