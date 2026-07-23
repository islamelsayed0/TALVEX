import { describe, expect, it } from 'vitest'

import {
  decide,
  nextState,
  REOPEN_COOLDOWN_MS,
  type EngineAction,
  type EngineCheck,
  type EngineState,
  type IncidentEventInput,
} from '@/lib/monitoring/incident-engine'

// Unit suite for the incident engine, the heart of Phase 1 Task 2. Every
// product ruling is pinned here as a tape of check results driven through
// the pure state machine; no database, no clock, no I/O. The cron sweep
// performs what these actions describe, so what passes here is exactly the
// behavior production exhibits between sweeps.

const T0 = '2026-07-23T06:00:00.000Z'

/** T0 plus some minutes, for readable tapes. */
function at(minutes: number): string {
  return new Date(Date.parse(T0) + minutes * 60_000).toISOString()
}

let checkCounter = 0
function check(status: 'up' | 'down', checkedAt: string): EngineCheck {
  return { id: `check_${++checkCounter}`, status, checkedAt }
}

const healthy: EngineState = {
  failingSince: null,
  openIncidentId: null,
  lastResolved: null,
}

// ---------------------------------------------------------------------------
// A tiny tape runner: evolves state with nextState and collects what a
// database would accumulate, so multi step scenarios assert the whole
// record, not just the last action.

type SimIncident = {
  id: string
  openedAt: string
  resolvedAt: string | null
  reopenCount: number
}

function runTape(tape: EngineCheck[]) {
  let state = healthy
  let nextId = 0
  const incidents: SimIncident[] = []
  const timeline: Array<IncidentEventInput & { incidentId: string }> = []
  const actions: EngineAction[] = []

  for (const c of tape) {
    const action = decide(state, c)
    actions.push(action)
    let openedId: string | undefined
    if (action.kind === 'open') {
      openedId = `incident_${++nextId}`
      incidents.push({
        id: openedId,
        openedAt: action.openedAt,
        resolvedAt: null,
        reopenCount: 0,
      })
    }
    if (action.kind === 'reopen') {
      const incident = incidents.find((i) => i.id === action.incidentId)!
      incident.resolvedAt = null
      incident.reopenCount++
    }
    if (action.kind === 'resolve') {
      incidents.find((i) => i.id === action.incidentId)!.resolvedAt =
        action.resolvedAt
    }
    if ('events' in action) {
      const incidentId =
        action.kind === 'open' ? openedId! : action.incidentId
      timeline.push(...action.events.map((e) => ({ ...e, incidentId })))
    }
    state = nextState(state, action, openedId)
  }

  return { state, incidents, timeline, actions }
}

// ---------------------------------------------------------------------------

describe('confirmation before opening (ruling 1)', () => {
  it('a single failed check never opens an incident, it awaits confirmation', () => {
    const action = decide(healthy, check('down', at(0)))
    expect(action).toEqual({ kind: 'await_confirmation', failingSince: at(0) })
  })

  it('failure then recovery on the recheck is a blip: no incident, state clears', () => {
    const { incidents, timeline, state, actions } = runTape([
      check('down', at(0)),
      check('up', at(10)),
    ])
    expect(actions.map((a) => a.kind)).toEqual([
      'await_confirmation',
      'record_blip',
    ])
    expect(incidents).toEqual([])
    expect(timeline).toEqual([])
    expect(state).toEqual(healthy)
  })

  it('failure confirmed by the recheck opens an incident backdated to the first failure', () => {
    const first = check('down', at(0))
    const confirming = check('down', at(10))
    const { incidents, timeline } = runTape([first, confirming])

    expect(incidents).toHaveLength(1)
    // Backdated: the outage began at the first failed check, not the recheck.
    expect(incidents[0].openedAt).toBe(at(0))
    expect(incidents[0].resolvedAt).toBeNull()

    expect(timeline).toHaveLength(1)
    expect(timeline[0]).toMatchObject({
      eventType: 'opened',
      occurredAt: at(0),
      checkId: confirming.id,
    })
  })

  it('a down check while an incident is already open changes nothing', () => {
    const state: EngineState = { ...healthy, openIncidentId: 'incident_x' }
    expect(decide(state, check('down', at(0)))).toEqual({ kind: 'none' })
  })

  it('an up check on a healthy monitor changes nothing', () => {
    expect(decide(healthy, check('up', at(0)))).toEqual({ kind: 'none' })
  })
})

describe('auto resolve (ruling 2)', () => {
  it('the first up check on an open incident resolves it, with recovered and resolved events', () => {
    const up = check('up', at(60))
    const state: EngineState = { ...healthy, openIncidentId: 'incident_x' }
    const action = decide(state, up)

    expect(action.kind).toBe('resolve')
    if (action.kind !== 'resolve') return
    expect(action.incidentId).toBe('incident_x')
    expect(action.resolvedAt).toBe(at(60))
    expect(action.events.map((e) => e.eventType)).toEqual([
      'recovered',
      'resolved',
    ])
    expect(action.events[0]).toMatchObject({
      occurredAt: at(60),
      checkId: up.id,
    })
    expect(action.events[1].occurredAt).toBe(at(60))
  })
})

describe('flap cooldown (ruling 4)', () => {
  /** A resolved incident lying `gapMinutes` before the next failure. */
  function afterResolution(gapMinutes: number) {
    return runTape([
      check('down', at(0)),
      check('down', at(10)), // opens, backdated to 0
      check('up', at(20)), // resolves at 20
      check('down', at(20 + gapMinutes)), // down again
      check('down', at(20 + gapMinutes + 10)), // confirmed
    ])
  }

  it('a confirmed failure within 30 minutes of resolution reopens the same incident', () => {
    const { incidents, timeline } = afterResolution(15)

    expect(incidents).toHaveLength(1)
    expect(incidents[0].reopenCount).toBe(1)
    expect(incidents[0].resolvedAt).toBeNull()
    // History preserved: the original opening stands.
    expect(incidents[0].openedAt).toBe(at(0))
    expect(timeline.map((e) => e.eventType)).toEqual([
      'opened',
      'recovered',
      'resolved',
      'reopened',
    ])
    // The reopened event happens when the monitor went down again, not when
    // the recheck confirmed it.
    expect(timeline[3].occurredAt).toBe(at(35))
  })

  it('a confirmed failure after the cooldown opens a new incident', () => {
    const { incidents } = afterResolution(31)
    expect(incidents).toHaveLength(2)
    expect(incidents[0].resolvedAt).toBe(at(20))
    expect(incidents[1].openedAt).toBe(at(51))
    expect(incidents[1].resolvedAt).toBeNull()
  })

  it('the cooldown measures resolution to the new failure, not to the confirming recheck', () => {
    // Down again 15 minutes after resolving, but the confirming recheck
    // arrives hours later (the daily cron reality). Still a reopen: the gap
    // that matters is how quickly the monitor fell over again.
    const { incidents } = runTape([
      check('down', at(0)),
      check('down', at(10)),
      check('up', at(20)),
      check('down', at(35)), // 15 minutes after resolution
      check('down', at(35 + 24 * 60)), // recheck a day later
    ])
    expect(incidents).toHaveLength(1)
    expect(incidents[0].reopenCount).toBe(1)
  })

  it('the boundary is strict: exactly 30 minutes is a new incident', () => {
    expect(REOPEN_COOLDOWN_MS).toBe(30 * 60 * 1000)
    const { incidents } = afterResolution(30)
    expect(incidents).toHaveLength(2)
  })
})

describe('the full flapping tape', () => {
  it('down, up, down, up, down inside one window is exactly one incident with a legible timeline', () => {
    // Each "down" is a confirmed failure (two consecutive failed checks,
    // per ruling 1); each "up" resolves. All inside one 30 minute window
    // from each resolution, so the cooldown folds the whole mess into a
    // single incident.
    const { incidents, timeline, state } = runTape([
      check('down', at(0)),
      check('down', at(2)), // opens (backdated to 0)
      check('up', at(4)), // resolves
      check('down', at(6)),
      check('down', at(8)), // reopens
      check('up', at(10)), // resolves again
      check('down', at(12)),
      check('down', at(14)), // reopens again
    ])

    expect(incidents).toHaveLength(1)
    expect(incidents[0].openedAt).toBe(at(0))
    expect(incidents[0].reopenCount).toBe(2)
    expect(incidents[0].resolvedAt).toBeNull()
    expect(state.openIncidentId).toBe(incidents[0].id)

    // The timeline reads correctly, in order.
    expect(timeline.map((e) => [e.eventType, e.occurredAt])).toEqual([
      ['opened', at(0)],
      ['recovered', at(4)],
      ['resolved', at(4)],
      ['reopened', at(6)],
      ['recovered', at(10)],
      ['resolved', at(10)],
      ['reopened', at(12)],
    ])
    // Chronological already: append order and occurred_at order agree.
    const times = timeline.map((e) => Date.parse(e.occurredAt))
    expect(times).toEqual([...times].sort((a, b) => a - b))

    // Every event lands on the one incident.
    expect(new Set(timeline.map((e) => e.incidentId)).size).toBe(1)
  })
})
