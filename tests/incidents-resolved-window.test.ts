import { describe, expect, it } from 'vitest'

import { resolvedWithin } from '../src/app/dashboard/incidents/ui'

describe('resolvedWithin', () => {
  const now = Date.parse('2026-07-25T12:00:00Z')

  it('keeps only resolutions inside the last week, never the unresolved', () => {
    const rows = [
      { id: 'today', resolved_at: '2026-07-25T07:00:00Z' },
      { id: 'five-days', resolved_at: '2026-07-20T12:00:00Z' },
      { id: 'eight-days', resolved_at: '2026-07-17T12:00:00Z' },
      { id: 'never', resolved_at: null },
    ]
    expect(resolvedWithin(rows, now).map((r) => r.id)).toEqual([
      'today',
      'five-days',
    ])
  })
})
