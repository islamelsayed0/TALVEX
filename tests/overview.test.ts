import { describe, expect, it } from 'vitest'

import {
  barKind,
  buildActivity,
  deriveVerdict,
  greeting,
  joinNames,
  partOfDay,
  shortAge,
  sparklineGeometry,
  summarizeTickets,
  ticketSource,
} from '../src/app/dashboard/_overview/lib'

// The Overview renders from real data, so its logic is pure and tested here.
// The point of these is that nothing is invented: counts, verdict copy, source
// labels, and the activity feed are all deterministic functions of the input.

describe('greeting', () => {
  it('picks the part of day by hour', () => {
    expect(partOfDay(6)).toBe('morning')
    expect(partOfDay(13)).toBe('afternoon')
    expect(partOfDay(20)).toBe('evening')
  })
  it('addresses the person by name', () => {
    const morning = new Date('2026-07-24T09:00:00Z')
    expect(greeting(morning, 'Dana')).toBe('Good morning, Dana')
  })
})

describe('joinNames', () => {
  it('reads as a sentence', () => {
    expect(joinNames([])).toBe('')
    expect(joinNames(['A'])).toBe('A')
    expect(joinNames(['A', 'B'])).toBe('A and B')
    expect(joinNames(['A', 'B', 'C'])).toBe('A, B and C')
  })
})

describe('deriveVerdict', () => {
  it('reports the down systems by name', () => {
    const v = deriveVerdict({
      downNames: ['Booking API', 'VPN Gateway'],
      openIncidents: 2,
      openTickets: 6,
      upCount: 7,
    })
    expect(v.tone).toBe('down')
    expect(v.title).toBe('2 systems are down')
    expect(v.subtitle).toContain('Booking API and VPN Gateway need attention')
    expect(v.subtitle).toContain('2 incidents and 6 tickets are open')
  })
  it('uses the singular when one system is down', () => {
    const v = deriveVerdict({
      downNames: ['Booking API'],
      openIncidents: 1,
      openTickets: 0,
      upCount: 9,
    })
    expect(v.title).toBe('One system is down')
    expect(v.subtitle).toContain('Booking API needs attention')
  })
  it('is all clear when nothing is down', () => {
    const v = deriveVerdict({
      downNames: [],
      openIncidents: 0,
      openTickets: 2,
      upCount: 10,
    })
    expect(v.tone).toBe('clear')
    expect(v.title).toBe('All systems are operational')
    expect(v.subtitle).toBe(
      '10 monitors up. No open incidents. 2 tickets are waiting on you.',
    )
  })
})

describe('ticketSource', () => {
  it('names where a ticket came from', () => {
    expect(ticketSource({ incident_id: 'i1', conversation_id: null })).toBe(
      'From incident',
    )
    expect(ticketSource({ incident_id: null, conversation_id: 'c1' })).toBe(
      'From chat',
    )
    expect(ticketSource({ incident_id: null, conversation_id: null })).toBe(
      'Manual',
    )
  })
})

describe('summarizeTickets', () => {
  const now = Date.parse('2026-07-24T18:00:00Z')
  it('counts by status and resolved-today by UTC day', () => {
    const c = summarizeTickets(
      [
        { status: 'open', resolved_at: null },
        { status: 'open', resolved_at: null },
        { status: 'in_progress', resolved_at: null },
        { status: 'resolved', resolved_at: '2026-07-24T07:00:00Z' }, // today
        { status: 'resolved', resolved_at: '2026-07-23T23:00:00Z' }, // yesterday
        { status: 'closed', resolved_at: '2026-07-20T10:00:00Z' },
      ],
      now,
    )
    expect(c).toEqual({ open: 2, inProgress: 1, resolvedToday: 1, closed: 1 })
  })
})

describe('barKind', () => {
  it('maps a check status to a bar kind', () => {
    expect(barKind('up')).toBe('up')
    expect(barKind('down')).toBe('down')
    expect(barKind('timeout')).toBe('pending')
  })
})

describe('shortAge', () => {
  const now = Date.parse('2026-07-24T12:00:00Z')
  it('is compact across scales', () => {
    expect(shortAge('2026-07-24T11:59:30Z', now)).toBe('30s')
    expect(shortAge('2026-07-24T11:46:00Z', now)).toBe('14m')
    expect(shortAge('2026-07-24T10:00:00Z', now)).toBe('2h')
    expect(shortAge('2026-07-18T12:00:00Z', now)).toBe('6d')
  })
})

describe('sparklineGeometry', () => {
  it('is null below two points, so the caller shows an empty state', () => {
    expect(sparklineGeometry([])).toBeNull()
    expect(sparklineGeometry([200])).toBeNull()
  })
  it('draws a closed area path from the points', () => {
    const geo = sparklineGeometry([100, 200], 200, 40)
    expect(geo).not.toBeNull()
    expect(geo!.line.startsWith('M0.0,')).toBe(true)
    expect(geo!.area.endsWith('L0,40 Z')).toBe(true)
  })
})

describe('buildActivity', () => {
  it('merges real incidents and tickets newest first, nothing invented', () => {
    const items = buildActivity({
      openIncidents: [
        { id: 'i1', monitorName: 'VPN Gateway', opened_at: '2026-07-24T11:57:00Z' },
      ],
      resolvedIncidents: [
        {
          id: 'i2',
          monitorName: 'File Server',
          resolved_at: '2026-07-24T11:00:00Z',
        },
      ],
      tickets: [
        {
          id: 't1',
          title: 'VPN keeps dropping',
          created_at: '2026-07-24T11:56:00Z',
          incident_id: 'i1',
        },
      ],
    })
    expect(items.map((i) => i.text)).toEqual([
      'VPN Gateway went down',
      'Ticket opened: VPN keeps dropping (from an incident)',
      'File Server recovered',
    ])
    expect(items[0].tone).toBe('down')
  })
})
