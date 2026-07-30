import { describe, expect, it, vi } from 'vitest'

// The tickets data layer imports Clerk for its session bound functions; the
// pure trail helper used here never touches it (tests/ticket-queue.test.ts
// established this shape).
vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }))

import { interleaveTrail } from '@/lib/db/tickets'
import { DEFAULT_TIMEZONE } from '@/lib/db/usage'
import {
  composeDigest,
  digestDueCheck,
  digestSection,
  digestSubject,
  digestWindowStartMs,
  formatAge,
  isAwaitingReply,
  parseSendTime,
  waitingSinceMs,
  type DigestData,
  type DigestSchedule,
  type DigestTrailItem,
} from '@/lib/notifications/digest'

/**
 * The daily digest's two decisions, both pure and both pinned here: WHEN a
 * digest is due (org local clock, across daylight saving and across the date
 * line) and WHAT it says (sections, links, counts, and the quiet day).
 *
 * The sending itself is proved by the isolation suite and by the cron path;
 * nothing here touches a network or a database.
 */

const BASE = 'https://talvex.example.com'

// ---------------------------------------------------------------------------
// Helpers.

function section<T>(items: T[], total = items.length) {
  return { items, total }
}

const EMPTY: DigestData = {
  openIncidents: section([]),
  awaitingReply: section([]),
  newTickets: section([]),
  lowStock: section([]),
}

function comment(author: string, createdAt: string) {
  return { ticket_id: 't1', author, created_at: createdAt }
}

function event(occurredAt: string) {
  return { ticket_id: 't1', occurred_at: occurredAt }
}

/** A trail built through the shared tickets logic, exactly as the sweep does. */
function trail(
  comments: Array<{ ticket_id: string; author: string; created_at: string }>,
  events: Array<{ ticket_id: string; occurred_at: string }>,
): DigestTrailItem[] {
  return interleaveTrail(comments, events)
}

// ---------------------------------------------------------------------------

describe('parseSendTime', () => {
  it('reads the two shapes the database and the form produce', () => {
    expect(parseSendTime('08:00')).toBe(480)
    expect(parseSendTime('08:00:00')).toBe(480)
    expect(parseSendTime('07:30')).toBe(450)
    expect(parseSendTime('00:00')).toBe(0)
    expect(parseSendTime('23:59')).toBe(1439)
  })

  it('refuses anything that is not a time on the clock', () => {
    for (const bad of ['', 'noon', '24:00', '07:60', '7', '07:30:30', '-1:00']) {
      expect(parseSendTime(bad), bad).toBeNull()
    }
  })
})

describe('digestDueCheck', () => {
  const schedule = (over: Partial<DigestSchedule> = {}): DigestSchedule => ({
    timeZone: 'America/New_York',
    sendTime: '07:30',
    lastSentOn: null,
    ...over,
  })

  it('is not due before the org local send time', () => {
    // 12:29 UTC is 07:29 in New York in January (EST, UTC minus 5).
    const check = digestDueCheck(schedule(), Date.parse('2026-01-15T12:29:00Z'))
    expect(check.due).toBe(false)
    expect(check.today).toBe('2026-01-15')
    expect(check.localMinutes).toBe(7 * 60 + 29)
  })

  it('is due once the org local clock reaches the send time', () => {
    const check = digestDueCheck(schedule(), Date.parse('2026-01-15T12:30:00Z'))
    expect(check.due).toBe(true)
    expect(check.today).toBe('2026-01-15')
  })

  it('is still due a few minutes late, because the sweep runs every 5 minutes', () => {
    // A 07:30 setting is never missed just because no sweep lands on 07:30.
    expect(digestDueCheck(schedule(), Date.parse('2026-01-15T12:34:00Z')).due).toBe(true)
  })

  it('honours the SAME wall clock across daylight saving', () => {
    // The point of the whole feature: 07:30 is their 07:30 in both seasons,
    // which is two different UTC instants. Winter is UTC minus 5, summer minus 4.
    const winter = digestDueCheck(schedule(), Date.parse('2026-01-15T12:30:00Z'))
    const summer = digestDueCheck(schedule(), Date.parse('2026-07-15T11:30:00Z'))
    expect(winter.due).toBe(true)
    expect(summer.due).toBe(true)
    expect(winter.localMinutes).toBe(summer.localMinutes)

    // And the summer instant that WOULD have been 07:30 in winter is 08:30
    // local, still due, but an hour late rather than on time. The proof that
    // no fixed offset is being stored anywhere.
    expect(
      digestDueCheck(schedule(), Date.parse('2026-07-15T12:30:00Z')).localMinutes,
    ).toBe(8 * 60 + 30)
  })

  it('sends on the day a zone springs forward, on the first sweep after the jump', () => {
    // New York, 8 March 2026: 02:00 becomes 03:00, so a 02:30 setting names a
    // local time that does not exist that day. It must not be skipped.
    const springForward = schedule({ sendTime: '02:30' })
    // 06:59 UTC is 01:59 EST, before the jump.
    expect(digestDueCheck(springForward, Date.parse('2026-03-08T06:59:00Z')).due).toBe(false)
    // 07:00 UTC is 03:00 EDT: the clock has passed 02:30 without ever showing it.
    const after = digestDueCheck(springForward, Date.parse('2026-03-08T07:00:00Z'))
    expect(after.due).toBe(true)
    expect(after.today).toBe('2026-03-08')
  })

  it('sends once on the day a zone falls back, not twice', () => {
    // New York, 1 November 2026: 01:00 EDT to 01:00 EST, so 01:30 local
    // happens twice. The ledger, not the clock, is what stops the second one.
    const fallBack = schedule({ sendTime: '01:30' })
    const firstPass = digestDueCheck(fallBack, Date.parse('2026-11-01T05:30:00Z'))
    expect(firstPass.due).toBe(true)
    expect(firstPass.today).toBe('2026-11-01')

    const secondPass = digestDueCheck(
      schedule({ sendTime: '01:30', lastSentOn: firstPass.today }),
      Date.parse('2026-11-01T06:30:00Z'),
    )
    expect(secondPass.today).toBe('2026-11-01')
    expect(secondPass.due).toBe(false)
  })

  it('is not due again once today is already stamped', () => {
    expect(
      digestDueCheck(schedule({ lastSentOn: '2026-01-15' }), Date.parse('2026-01-15T18:00:00Z'))
        .due,
    ).toBe(false)
  })

  it('is due again the next day', () => {
    expect(
      digestDueCheck(schedule({ lastSentOn: '2026-01-14' }), Date.parse('2026-01-15T12:30:00Z'))
        .due,
    ).toBe(true)
  })

  it('reads the date in the org zone, not in UTC', () => {
    // 22:30 UTC on the 15th is already 07:30 on the 16th in Tokyo. The date
    // that gets stamped has to be the org's, or the ledger dedups the wrong day.
    const tokyo = digestDueCheck(
      { timeZone: 'Asia/Tokyo', sendTime: '07:30', lastSentOn: null },
      Date.parse('2026-07-15T22:30:00Z'),
    )
    expect(tokyo.due).toBe(true)
    expect(tokyo.today).toBe('2026-07-16')
  })

  it('falls back to the app default zone the same way the rest of the app does', () => {
    // The org that has never had a zone detected. The route passes
    // DEFAULT_TIMEZONE, so the digest behaves as a New York org would.
    expect(DEFAULT_TIMEZONE).toBe('America/New_York')
    const fallback = digestDueCheck(
      { timeZone: DEFAULT_TIMEZONE, sendTime: '07:30', lastSentOn: null },
      Date.parse('2026-01-15T12:30:00Z'),
    )
    expect(fallback.due).toBe(true)
    expect(fallback.today).toBe('2026-01-15')
  })

  it('stays quiet rather than emailing everyone when the time is unreadable', () => {
    expect(digestDueCheck(schedule({ sendTime: 'garbage' }), Date.now()).due).toBe(false)
  })
})

describe('digestWindowStartMs', () => {
  it('reaches back 24 hours when there was no previous digest', () => {
    const now = Date.parse('2026-01-15T12:30:00Z')
    expect(
      digestWindowStartMs(
        { timeZone: 'America/New_York', sendTime: '07:30', lastSentOn: null },
        now,
      ),
    ).toBe(now - 24 * 60 * 60 * 1000)
  })

  it('reaches back to when the previous digest actually went out', () => {
    // 07:30 New York on 14 January is 12:30 UTC, not midnight anywhere.
    expect(
      digestWindowStartMs(
        { timeZone: 'America/New_York', sendTime: '07:30', lastSentOn: '2026-01-14' },
        Date.parse('2026-01-15T12:30:00Z'),
      ),
    ).toBe(Date.parse('2026-01-14T12:30:00Z'))
  })

  it('measures the previous send in the zone it was sent in, across daylight saving', () => {
    // Sent 07:30 EST on 7 March, asked on 8 March after the spring forward.
    expect(
      digestWindowStartMs(
        { timeZone: 'America/New_York', sendTime: '07:30', lastSentOn: '2026-03-07' },
        Date.parse('2026-03-08T12:30:00Z'),
      ),
    ).toBe(Date.parse('2026-03-07T12:30:00Z'))
  })
})

describe('isAwaitingReply', () => {
  const REQUESTER = 'user_requester'
  const AGENT = 'user_agent'

  it('is waiting when nobody has said anything at all', () => {
    // Just the 'created' system event. The plainest case: they asked, silence.
    expect(isAwaitingReply(REQUESTER, trail([], [event('2026-01-01T09:00:00Z')]))).toBe(true)
  })

  it('is waiting when the requester spoke last', () => {
    const t = trail(
      [comment(REQUESTER, '2026-01-01T09:00:00Z'), comment(AGENT, '2026-01-01T10:00:00Z'), comment(REQUESTER, '2026-01-01T11:00:00Z')],
      [event('2026-01-01T08:00:00Z')],
    )
    expect(isAwaitingReply(REQUESTER, t)).toBe(true)
  })

  it('is not waiting when someone else replied last', () => {
    const t = trail(
      [comment(REQUESTER, '2026-01-01T09:00:00Z'), comment(AGENT, '2026-01-01T10:00:00Z')],
      [event('2026-01-01T08:00:00Z')],
    )
    expect(isAwaitingReply(REQUESTER, t)).toBe(false)
  })

  it('does NOT treat a later status change as a reply', () => {
    // The reading that matters, and the reason events are skipped rather than
    // counted: moving a ticket to in_progress tells the requester nothing, so
    // it must not drop the ticket out of the digest while they are still
    // waiting to hear back. Counting it would silently suppress.
    const t = trail(
      [comment(REQUESTER, '2026-01-01T09:00:00Z')],
      [event('2026-01-01T08:00:00Z'), event('2026-01-01T12:00:00Z')],
    )
    expect(isAwaitingReply(REQUESTER, t)).toBe(true)
  })

  it('is not waiting when a status change follows a real reply', () => {
    const t = trail(
      [comment(REQUESTER, '2026-01-01T09:00:00Z'), comment(AGENT, '2026-01-01T10:00:00Z')],
      [event('2026-01-01T12:00:00Z')],
    )
    expect(isAwaitingReply(REQUESTER, t)).toBe(false)
  })
})

describe('waitingSinceMs', () => {
  const REQUESTER = 'user_requester'
  const AGENT = 'user_agent'
  const ticket = { submittedBy: REQUESTER, createdAtIso: '2026-01-01T08:00:00Z' }

  it('measures from the ticket when the requester has said nothing since opening it', () => {
    expect(waitingSinceMs(ticket, trail([], [event('2026-01-01T08:00:00Z')]))).toBe(
      Date.parse('2026-01-01T08:00:00Z'),
    )
  })

  it('measures from the requester last message when there is one', () => {
    const t = trail(
      [comment(REQUESTER, '2026-01-01T09:00:00Z'), comment(AGENT, '2026-01-01T10:00:00Z'), comment(REQUESTER, '2026-01-02T11:00:00Z')],
      [],
    )
    expect(waitingSinceMs(ticket, t)).toBe(Date.parse('2026-01-02T11:00:00Z'))
  })
})

describe('formatAge', () => {
  it('reads the way the incidents screen reads', () => {
    expect(formatAge(30_000)).toBe('under a minute')
    expect(formatAge(4 * 60_000)).toBe('4m')
    expect(formatAge(72 * 60_000)).toBe('1h 12m')
    expect(formatAge(52 * 60 * 60_000)).toBe('2d 4h')
  })
})

describe('digestSection', () => {
  it('keeps the true total when it caps what gets listed', () => {
    const all = Array.from({ length: 40 }, (_, i) => i)
    const capped = digestSection(all)
    expect(capped.total).toBe(40)
    expect(capped.items).toHaveLength(15)
    expect(capped.items[0]).toBe(0)
  })
})

describe('composeDigest', () => {
  const NOW = Date.parse('2026-01-15T12:30:00Z')
  const opts = { baseUrl: BASE, nowMs: NOW }

  const full: DigestData = {
    openIncidents: section([
      {
        incidentId: 'inc-1',
        monitorName: 'Northwind Web',
        openedAtIso: '2026-01-15T08:18:00Z',
      },
    ]),
    awaitingReply: section([
      { ticketId: 'tkt-1', title: 'Printer will not connect', sinceIso: '2026-01-13T08:30:00Z' },
    ]),
    newTickets: section([
      { ticketId: 'tkt-2', title: 'New laptop request', sinceIso: '2026-01-15T06:30:00Z' },
    ]),
    lowStock: section([
      { itemId: 'inv-1', name: 'Toner cartridge', quantity: 1, minStock: 3 },
    ]),
  }

  it('is nothing at all on a quiet day', () => {
    // THE ruling: there is no all clear email to suppress downstream, because
    // composition never produces one.
    expect(composeDigest(EMPTY, opts)).toBeNull()
  })

  it('renders every section when every section has something', () => {
    const email = composeDigest(full, opts)!
    expect(email).not.toBeNull()
    expect(email.text).toContain('Open incidents (1)')
    expect(email.text).toContain('Tickets waiting on a reply (1)')
    expect(email.text).toContain('New tickets (1)')
    expect(email.text).toContain('Low on stock (1)')
  })

  it('carries names, ages and quantities, and links every line to its real route', () => {
    const email = composeDigest(full, opts)!
    expect(email.text).toContain('Northwind Web, down 4h 12m')
    expect(email.text).toContain(`${BASE}/dashboard/incidents/inc-1`)
    expect(email.text).toContain('Printer will not connect, waiting 2d 4h')
    expect(email.text).toContain(`${BASE}/dashboard/tickets/tkt-1`)
    expect(email.text).toContain('New laptop request, 6h 0m ago')
    expect(email.text).toContain(`${BASE}/dashboard/tickets/tkt-2`)
    expect(email.text).toContain('Toner cartridge, 1 in stock, minimum 3')
    expect(email.text).toContain(`${BASE}/dashboard/inventory/inv-1`)
    expect(email.text).toContain(`${BASE}/dashboard/settings/notifications`)
  })

  it('omits a section entirely rather than reporting it as zero', () => {
    const email = composeDigest({ ...full, lowStock: section([]) }, opts)!
    expect(email.text).not.toContain('Low on stock')
    expect(email.text).toContain('Open incidents')
  })

  it('says how many more there are when a section is capped, and links the list', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      incidentId: `inc-${i}`,
      monitorName: `Monitor ${i}`,
      openedAtIso: '2026-01-15T08:18:00Z',
    }))
    const email = composeDigest(
      { ...EMPTY, openIncidents: digestSection(many) },
      opts,
    )!
    // The heading count is the REAL number, not the listed number.
    expect(email.text).toContain('Open incidents (30)')
    expect(email.text).toContain('and 15 more')
    expect(email.text).toContain(`${BASE}/dashboard/incidents`)
    expect(email.subject).toContain('30 incidents')
  })

  it('never doubles the separator when the base URL has a trailing slash', () => {
    const email = composeDigest(full, { baseUrl: `${BASE}/`, nowMs: NOW })!
    expect(email.text).toContain(`${BASE}/dashboard/incidents/inc-1`)
    expect(email.text).not.toContain('//dashboard')
  })

  it('carries no ticket, comment, or note content, only titles and names', () => {
    // Ruling 5 as a guard rather than as a promise. The gathering side does
    // not even select these columns; this proves nothing reintroduces them.
    const email = composeDigest(full, opts)!
    for (const forbidden of ['description', 'body', 'notes']) {
      expect(email.text.toLowerCase()).not.toContain(forbidden)
    }
  })

  it('uses no hyphens in its prose', () => {
    // CLAUDE.md prose rule. URLs are exempt: an id is not prose.
    const email = composeDigest(full, opts)!
    expect(email.subject).not.toMatch(/-/)
    const prose = email.text
      .split('\n')
      .filter((line) => !line.trim().startsWith('http'))
    for (const line of prose) {
      expect(line, `hyphen in: "${line}"`).not.toMatch(/-/)
    }
  })

  it('says plainly that a quiet day means no email', () => {
    const email = composeDigest(full, opts)!
    expect(email.text).toContain('does not arrive at all')
  })
})

describe('digestSubject', () => {
  const incident = { incidentId: 'i', monitorName: 'M', openedAtIso: '2026-01-15T08:00:00Z' }
  const ticket = { ticketId: 't', title: 'T', sinceIso: '2026-01-15T08:00:00Z' }
  const item = { itemId: 'v', name: 'N', quantity: 0, minStock: 2 }

  it('reports both counts, and they are real', () => {
    expect(
      digestSubject({
        ...EMPTY,
        openIncidents: section([incident, incident]),
        awaitingReply: section([ticket, ticket, ticket]),
      }),
    ).toBe('[Talvex] Your day: 2 incidents, 3 tickets waiting')
  })

  it('drops an absent section from the phrasing instead of saying zero', () => {
    expect(digestSubject({ ...EMPTY, openIncidents: section([incident]) })).toBe(
      '[Talvex] Your day: 1 incident',
    )
    expect(digestSubject({ ...EMPTY, awaitingReply: section([ticket]) })).toBe(
      '[Talvex] Your day: 1 ticket waiting',
    )
  })

  it('falls through to whichever sections are present', () => {
    expect(
      digestSubject({
        ...EMPTY,
        newTickets: section([ticket, ticket]),
        lowStock: section([item]),
      }),
    ).toBe('[Talvex] Your day: 2 new tickets, 1 item low on stock')
  })

  it('reports the true total of a capped section', () => {
    const many = Array.from({ length: 30 }, () => ticket)
    expect(digestSubject({ ...EMPTY, awaitingReply: digestSection(many) })).toBe(
      '[Talvex] Your day: 30 tickets waiting',
    )
  })

  it('stays short by naming at most the two most important sections', () => {
    const subject = digestSubject({
      openIncidents: section([incident]),
      awaitingReply: section([ticket]),
      newTickets: section([ticket]),
      lowStock: section([item]),
    })
    expect(subject).toBe('[Talvex] Your day: 1 incident, 1 ticket waiting')
  })
})
