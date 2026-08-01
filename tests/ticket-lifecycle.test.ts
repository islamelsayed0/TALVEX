import { describe, expect, it, vi } from 'vitest'

// The tickets data layer imports Clerk for its session bound functions; the
// pure helpers under test here never touch it.
vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }))

import {
  isHiddenFromMemberList,
  isTerminalTicketStatus,
  MEMBER_LIST_TERMINAL_DAYS,
  MEMBER_TRANSITIONS,
  memberCanMove,
  terminalTransitionAtMs,
  TICKET_STATUSES,
} from '@/lib/db/tickets'
import { isAwaitingReply, waitingSinceMs } from '@/lib/notifications/digest'
import type { DigestTrailItem } from '@/lib/notifications/digest'

/**
 * The ticket lifecycle rulings (migration 019), pinned as unit tests where the
 * logic is pure. The database is the authority for every one of these: the
 * matrix below is enforced by member_set_ticket_status and proved against a
 * real Postgres in tests/isolation/ticket-isolation.test.ts. What is tested
 * here is the version the SCREENS read, so the two cannot drift and show a
 * button the database will refuse.
 */

describe('the member state machine', () => {
  it('lets a requester resolve or cancel from either working state', () => {
    for (const from of ['open', 'in_progress'] as const) {
      expect(memberCanMove(from, 'resolved')).toBe(true)
      expect(memberCanMove(from, 'canceled')).toBe(true)
    }
  })

  it('lets a requester reopen a resolved ticket', () => {
    expect(memberCanMove('resolved', 'open')).toBe(true)
  })

  it('never lets a requester set in_progress: that is admin signal', () => {
    for (const from of TICKET_STATUSES) {
      expect(memberCanMove(from, 'in_progress')).toBe(false)
    }
  })

  it('treats canceled as terminal for the requester, from every direction', () => {
    // A withdrawn request coming back is a new request, by ruling. If this ever
    // goes green for some target, the member has been handed a resurrection.
    expect(MEMBER_TRANSITIONS.canceled).toEqual([])
    for (const to of TICKET_STATUSES) {
      expect(memberCanMove('canceled', to)).toBe(false)
    }
  })

  it('refuses every no op, so a redundant press cannot forge a trail entry', () => {
    for (const status of TICKET_STATUSES) {
      expect(memberCanMove(status, status)).toBe(false)
    }
  })

  it('does not let a requester cancel a ticket that is already resolved', () => {
    // Cancel is a withdrawal, and you cannot withdraw something already done.
    expect(memberCanMove('resolved', 'canceled')).toBe(false)
  })

  it('names exactly two terminal states', () => {
    expect(TICKET_STATUSES.filter(isTerminalTicketStatus)).toEqual([
      'resolved',
      'canceled',
    ])
  })
})

// ---------------------------------------------------------------------------
// The seven day window, derived from the trail rather than a column.

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-07-31T12:00:00Z')

function statusEvent(to: string, at: string) {
  return {
    event_type: 'status_changed',
    detail: `Status changed from open to ${to.replace('_', ' ')}.`,
    occurred_at: at,
  }
}

describe('terminalTransitionAtMs', () => {
  it('is null for a ticket that has never settled', () => {
    expect(
      terminalTransitionAtMs([
        { event_type: 'created', detail: 'Ticket submitted.', occurred_at: '2026-07-01T00:00:00Z' },
      ]),
    ).toBeNull()
  })

  it('finds the moment a ticket was resolved', () => {
    const at = '2026-07-20T09:00:00Z'
    expect(terminalTransitionAtMs([statusEvent('resolved', at)])).toBe(
      Date.parse(at),
    )
  })

  it('finds the moment a ticket was canceled', () => {
    const at = '2026-07-20T09:00:00Z'
    expect(terminalTransitionAtMs([statusEvent('canceled', at)])).toBe(
      Date.parse(at),
    )
  })

  it('reports the LATEST settling when a ticket was resolved, reopened, resolved', () => {
    const events = [
      statusEvent('resolved', '2026-07-01T00:00:00Z'),
      { ...statusEvent('open', '2026-07-05T00:00:00Z') },
      statusEvent('resolved', '2026-07-28T00:00:00Z'),
    ]
    expect(terminalTransitionAtMs(events)).toBe(
      Date.parse('2026-07-28T00:00:00Z'),
    )
  })

  it('is null when the most recent transition moved OUT of a terminal state', () => {
    // Resolved long ago then reopened yesterday is not a settled ticket, and
    // reading the old resolution would hide something the person is waiting on.
    const events = [
      statusEvent('resolved', '2026-07-01T00:00:00Z'),
      statusEvent('open', '2026-07-30T00:00:00Z'),
    ]
    expect(terminalTransitionAtMs(events)).toBeNull()
  })

  it('ignores in_progress, which is not a settling', () => {
    expect(
      terminalTransitionAtMs([statusEvent('in_progress', '2026-07-02T00:00:00Z')]),
    ).toBeNull()
  })
})

describe('isHiddenFromMemberList', () => {
  const settled = { status: 'resolved', hidden_by_requester: false }

  it('keeps a ticket settled inside the window', () => {
    const at = NOW - (MEMBER_LIST_TERMINAL_DAYS - 1) * DAY
    expect(isHiddenFromMemberList(settled, at, NOW)).toBe(false)
  })

  it('keeps a ticket settled exactly on the boundary', () => {
    // Strictly older than the window drops off, so the boundary day stays.
    const at = NOW - MEMBER_LIST_TERMINAL_DAYS * DAY
    expect(isHiddenFromMemberList(settled, at, NOW)).toBe(false)
  })

  it('drops a ticket settled beyond the window', () => {
    const at = NOW - (MEMBER_LIST_TERMINAL_DAYS + 1) * DAY
    expect(isHiddenFromMemberList(settled, at, NOW)).toBe(true)
  })

  it('never hides an unsettled ticket, however old', () => {
    const ancient = { status: 'open', hidden_by_requester: false }
    expect(isHiddenFromMemberList(ancient, null, NOW)).toBe(false)
    const working = { status: 'in_progress', hidden_by_requester: false }
    expect(isHiddenFromMemberList(working, null, NOW)).toBe(false)
  })

  it('hides a ticket the requester removed, immediately and whatever its age', () => {
    const removed = { status: 'canceled', hidden_by_requester: true }
    expect(isHiddenFromMemberList(removed, NOW, NOW)).toBe(true)
  })

  it('hides a removed ticket even when it is somehow not settled', () => {
    // The database refuses to set the flag on an open ticket, so this should be
    // unreachable. It is asserted anyway: if the flag is set, honor it.
    const odd = { status: 'open', hidden_by_requester: true }
    expect(isHiddenFromMemberList(odd, null, NOW)).toBe(true)
  })

  it('keeps a settled ticket whose trail carries no terminal transition', () => {
    // Nothing to measure against, so the safe direction is showing it. Hiding
    // on a missing fact would make a ticket vanish for a reason nobody can see.
    expect(isHiddenFromMemberList(settled, null, NOW)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Internal notes and the digest.

function comment(
  author: string,
  at: string,
  isInternal = false,
): DigestTrailItem {
  return {
    kind: 'comment',
    at,
    comment: { author, created_at: at, is_internal: isInternal },
  }
}

describe('an internal note is not a reply', () => {
  const requester = 'user_member'
  const admin = 'user_admin'

  it('still counts the requester as waiting after an admin internal note', () => {
    // THE CASE THIS EXISTS FOR. The admin wrote something the requester cannot
    // see. Counting it would drop the ticket off the digest while the person
    // who asked is still waiting, which is the exact failure the awaiting rule
    // was written to prevent.
    const trail = [
      comment(requester, '2026-07-30T09:00:00Z'),
      comment(admin, '2026-07-30T10:00:00Z', true),
    ]
    expect(isAwaitingReply(requester, trail)).toBe(true)
  })

  it('stops counting them as waiting once the admin says something visible', () => {
    const trail = [
      comment(requester, '2026-07-30T09:00:00Z'),
      comment(admin, '2026-07-30T10:00:00Z', true),
      comment(admin, '2026-07-30T11:00:00Z'),
    ]
    expect(isAwaitingReply(requester, trail)).toBe(false)
  })

  it('measures the wait from the requester, skipping the internal note', () => {
    const asked = '2026-07-30T09:00:00Z'
    const trail = [
      comment(requester, asked),
      comment(admin, '2026-07-30T10:00:00Z', true),
    ]
    expect(
      waitingSinceMs(
        { submittedBy: requester, createdAtIso: '2026-07-01T00:00:00Z' },
        trail,
      ),
    ).toBe(Date.parse(asked))
  })

  it('treats a comment with no flag as visible, so old rows keep their meaning', () => {
    const trail: DigestTrailItem[] = [
      { kind: 'comment', at: '2026-07-30T10:00:00Z', comment: { author: admin, created_at: '2026-07-30T10:00:00Z' } },
    ]
    expect(isAwaitingReply(requester, trail)).toBe(false)
  })
})
