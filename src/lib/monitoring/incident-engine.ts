/**
 * The incident engine (Phase 1 Task 2, BRD F4): a pure state machine that
 * turns one monitor check result into at most one incident action. All the
 * product rulings live here, in one place, with no I/O, so the unit suite
 * in tests/incident-engine.test.ts can drive whole outage tapes through it.
 * The cron sweep is the only caller in production; it performs the writes
 * each action describes (see /api/cron/check-monitors).
 *
 * The rulings, as implemented:
 *
 * 1. Confirmation before opening. A single failed check never opens an
 *    incident. The first failure stamps monitors.failing_since and the NEXT
 *    sweep invocation rechecks. Still down: an incident opens, backdated to
 *    failing_since. Back up: a blip, recorded only as a check result.
 *    Honest note: on the current daily Hobby cron (vercel.json, decision
 *    log 2026-07-23) the confirming recheck is up to a day away, so an
 *    outage is confirmed slowly. The logic is already correct for any
 *    schedule and tightens automatically when the cron does.
 *
 * 2. Auto resolve. The first up check on a monitor with an open incident
 *    resolves it. No human step.
 *
 * 3. Lifecycle is open and resolved only.
 *
 * 4. Flap cooldown. A confirmed failure landing less than 30 minutes after
 *    the monitor's last incident resolved reopens that incident instead of
 *    opening a new one. The gap is measured from resolved_at to
 *    failing_since (when the monitor actually went down again), not to the
 *    confirming recheck: on a slow cron the recheck can be a day late, and
 *    measuring to it would make reopening impossible exactly when the
 *    cooldown matters.
 *
 * 5. Every action that changes an incident also appends system written
 *    timeline events (opened, reopened, recovered, resolved).
 */

export const REOPEN_COOLDOWN_MS = 30 * 60 * 1000

export type EngineCheck = {
  /** id of the monitor_checks row this result was recorded as. */
  id: string
  status: 'up' | 'down'
  /** ISO timestamp the check ran at. */
  checkedAt: string
}

/** What the engine needs to know about one monitor before deciding. */
export type EngineState = {
  /** monitors.failing_since: first unconfirmed failure, or null. */
  failingSince: string | null
  /** The monitor's open incident, if any (at most one by unique index). */
  openIncidentId: string | null
  /** The monitor's most recently resolved incident, for the flap cooldown. */
  lastResolved: { incidentId: string; resolvedAt: string } | null
}

export type IncidentEventInput = {
  eventType: 'opened' | 'reopened' | 'recovered' | 'resolved'
  occurredAt: string
  checkId: string | null
  detail: string | null
}

export type EngineAction =
  /** Nothing to do (up and healthy, or down while an incident is already open). */
  | { kind: 'none' }
  /** First failure: stamp failing_since and wait for the confirming recheck. */
  | { kind: 'await_confirmation'; failingSince: string }
  /** The recheck came back up: clear failing_since, no incident. */
  | { kind: 'record_blip' }
  /** Confirmed failure with no recent incident: open, backdated. */
  | { kind: 'open'; openedAt: string; events: IncidentEventInput[] }
  /** Confirmed failure inside the cooldown: reopen the last incident. */
  | {
      kind: 'reopen'
      incidentId: string
      reopenedAt: string
      events: IncidentEventInput[]
    }
  /** Up check on an open incident: resolve it. */
  | {
      kind: 'resolve'
      incidentId: string
      resolvedAt: string
      events: IncidentEventInput[]
    }

/** Decides what one check result does to one monitor's incident state. */
export function decide(state: EngineState, check: EngineCheck): EngineAction {
  if (check.status === 'up') {
    if (state.openIncidentId !== null) {
      return {
        kind: 'resolve',
        incidentId: state.openIncidentId,
        resolvedAt: check.checkedAt,
        events: [
          {
            eventType: 'recovered',
            occurredAt: check.checkedAt,
            checkId: check.id,
            detail: 'The monitor responded normally again.',
          },
          {
            eventType: 'resolved',
            occurredAt: check.checkedAt,
            checkId: null,
            detail: 'Resolved automatically after the monitor recovered.',
          },
        ],
      }
    }
    if (state.failingSince !== null) {
      return { kind: 'record_blip' }
    }
    return { kind: 'none' }
  }

  // Down while an incident is open: the outage simply continues. The check
  // itself is the record; the timeline only marks state changes.
  if (state.openIncidentId !== null) {
    return { kind: 'none' }
  }

  if (state.failingSince === null) {
    return { kind: 'await_confirmation', failingSince: check.checkedAt }
  }

  // Confirmed: this is the second consecutive failed check.
  const downAgainAt = state.failingSince
  const withinCooldown =
    state.lastResolved !== null &&
    Date.parse(downAgainAt) - Date.parse(state.lastResolved.resolvedAt) <
      REOPEN_COOLDOWN_MS

  if (withinCooldown && state.lastResolved !== null) {
    return {
      kind: 'reopen',
      incidentId: state.lastResolved.incidentId,
      reopenedAt: downAgainAt,
      events: [
        {
          eventType: 'reopened',
          occurredAt: downAgainAt,
          checkId: check.id,
          detail:
            'The monitor went down again within 30 minutes of recovering, so this incident reopened.',
        },
      ],
    }
  }

  return {
    kind: 'open',
    openedAt: downAgainAt,
    events: [
      {
        eventType: 'opened',
        occurredAt: downAgainAt,
        checkId: check.id,
        detail:
          'Two checks in a row failed. Downtime counts from the first failed check.',
      },
    ],
  }
}

/**
 * The state transition each action implies. The cron sweep does not call
 * this (its next state is whatever the next sweep reads back from the
 * database); it exists so the tape tests evolve state through the same
 * definition the actions carry, rather than reimplementing it.
 *
 * `openedIncidentId` names the incident an 'open' action created; the
 * database assigns it in production, the test supplies it here.
 */
export function nextState(
  state: EngineState,
  action: EngineAction,
  openedIncidentId?: string,
): EngineState {
  switch (action.kind) {
    case 'none':
      return state
    case 'await_confirmation':
      return { ...state, failingSince: action.failingSince }
    case 'record_blip':
      return { ...state, failingSince: null }
    case 'open':
      if (openedIncidentId === undefined) {
        throw new Error("nextState for an 'open' action needs the new incident id")
      }
      return { ...state, failingSince: null, openIncidentId: openedIncidentId }
    case 'reopen':
      return {
        ...state,
        failingSince: null,
        openIncidentId: action.incidentId,
        lastResolved: null,
      }
    case 'resolve':
      return {
        ...state,
        failingSince: null,
        openIncidentId: null,
        lastResolved: {
          incidentId: action.incidentId,
          resolvedAt: action.resolvedAt,
        },
      }
  }
}
