import { describe, expect, it, vi } from 'vitest'

// The tickets data layer imports Clerk for its session bound functions;
// the pure helpers under test here never touch it.
vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }))

import { interleaveTrail, sortTicketsForQueue } from '@/lib/db/tickets'
import type { Ticket, TicketComment, TicketEvent } from '@/lib/db/types'

/**
 * The queue order ruling (open first, oldest open at top) and the trail
 * interleaving rule (chronological, system event first on a tie), pinned as
 * unit tests since both are pure functions the screens depend on.
 */

function ticket(partial: Partial<Ticket> & { id: string }): Ticket {
  return {
    org_id: 'org',
    submitted_by: 'user',
    title: partial.id,
    description: '',
    status: 'open',
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    resolved_at: null,
    closed_at: null,
    incident_id: null,
    ...partial,
  }
}

describe('sortTicketsForQueue', () => {
  it('groups by status: open, in progress, resolved, closed', () => {
    const sorted = sortTicketsForQueue([
      ticket({ id: 'c', status: 'closed', closed_at: '2026-07-10T00:00:00Z' }),
      ticket({ id: 'r', status: 'resolved', resolved_at: '2026-07-10T00:00:00Z' }),
      ticket({ id: 'p', status: 'in_progress' }),
      ticket({ id: 'o', status: 'open' }),
    ])
    expect(sorted.map((t) => t.id)).toEqual(['o', 'p', 'r', 'c'])
  })

  it('puts the oldest open ticket at the top: longest waiting first', () => {
    const sorted = sortTicketsForQueue([
      ticket({ id: 'newer', created_at: '2026-07-03T00:00:00Z' }),
      ticket({ id: 'oldest', created_at: '2026-07-01T00:00:00Z' }),
      ticket({ id: 'middle', created_at: '2026-07-02T00:00:00Z' }),
    ])
    expect(sorted.map((t) => t.id)).toEqual(['oldest', 'middle', 'newer'])
  })

  it('orders settled tickets newest first: recent history matters more', () => {
    const sorted = sortTicketsForQueue([
      ticket({ id: 'old', status: 'resolved', resolved_at: '2026-07-01T00:00:00Z' }),
      ticket({ id: 'new', status: 'resolved', resolved_at: '2026-07-05T00:00:00Z' }),
    ])
    expect(sorted.map((t) => t.id)).toEqual(['new', 'old'])
  })
})

function comment(id: string, at: string): TicketComment {
  return {
    id,
    org_id: 'org',
    ticket_id: 't',
    author: 'user',
    body: id,
    created_at: at,
  }
}

function event(id: string, at: string): TicketEvent {
  return {
    id,
    org_id: 'org',
    ticket_id: 't',
    event_type: 'created',
    actor: null,
    detail: null,
    occurred_at: at,
  }
}

describe('interleaveTrail', () => {
  it('merges comments and events chronologically', () => {
    const trail = interleaveTrail(
      [comment('c1', '2026-07-01T10:00:00Z'), comment('c2', '2026-07-01T12:00:00Z')],
      [event('e1', '2026-07-01T09:00:00Z'), event('e2', '2026-07-01T11:00:00Z')],
    )
    expect(
      trail.map((i) => (i.kind === 'event' ? i.event.id : i.comment.id)),
    ).toEqual(['e1', 'c1', 'e2', 'c2'])
  })

  it('puts the system event first on a timestamp tie, so created opens the trail', () => {
    const at = '2026-07-01T09:00:00Z'
    const trail = interleaveTrail([comment('c1', at)], [event('e1', at)])
    expect(trail.map((i) => i.kind)).toEqual(['event', 'comment'])
  })
})
