import { createOrgScopedClient } from './client'
import type { Incident, IncidentEvent } from './types'

/**
 * Typed data layer for incidents (CLAUDE.md code rule 7). Read only by
 * design: incidents and their timeline are written exclusively by the cron
 * sweep on the service role client, so this module exposes no create,
 * update, or delete. Everything here runs on the org scoped client; RLS has
 * filtered rows to the active organization before any code below sees them.
 */

export type IncidentListItem = Incident & {
  monitorName: string
  /** How many times the flap cooldown reopened this incident. */
  reopenCount: number
}

export type IncidentWithMonitor = Incident & {
  monitorName: string
  monitorUrl: string
}

const RESOLVED_LIMIT = 25

type EmbeddedRow = Incident & {
  monitors: { name: string } | null
  incident_events: Array<{ event_type: string }>
}

function toListItem({ monitors, incident_events, ...incident }: EmbeddedRow): IncidentListItem {
  return {
    ...incident,
    monitorName: monitors?.name ?? 'Deleted monitor',
    reopenCount: incident_events.filter((e) => e.event_type === 'reopened').length,
  }
}

/**
 * The incidents list: every open incident first (newest outage first), then
 * the most recently resolved ones.
 */
export async function listIncidents(): Promise<{
  open: IncidentListItem[]
  resolved: IncidentListItem[]
}> {
  const { client } = await createOrgScopedClient()

  const embed = '*, monitors(name), incident_events(event_type)'
  const [openRes, resolvedRes] = await Promise.all([
    client
      .from('incidents')
      .select(embed)
      .eq('status', 'open')
      .order('opened_at', { ascending: false }),
    client
      .from('incidents')
      .select(embed)
      .eq('status', 'resolved')
      .order('resolved_at', { ascending: false })
      .limit(RESOLVED_LIMIT),
  ])
  if (openRes.error) throw openRes.error
  if (resolvedRes.error) throw resolvedRes.error

  return {
    open: openRes.data.map(toListItem),
    resolved: resolvedRes.data.map(toListItem),
  }
}

/** One incident with its monitor, or null when not visible to this org. */
export async function getIncident(
  id: string,
): Promise<IncidentWithMonitor | null> {
  const { client } = await createOrgScopedClient()
  const { data, error } = await client
    .from('incidents')
    .select('*, monitors(name, url)')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const { monitors, ...incident } = data
  return {
    ...incident,
    monitorName: monitors?.name ?? 'Deleted monitor',
    monitorUrl: monitors?.url ?? '',
  }
}

/** Rank that breaks occurred_at ties the way the story reads: the monitor
 * recovers before the incident resolves, at the same instant. */
const EVENT_ORDER: Record<string, number> = {
  opened: 0,
  reopened: 1,
  recovered: 2,
  resolved: 3,
}

/** The full timeline of one incident, chronological. */
export async function listIncidentEvents(
  incidentId: string,
): Promise<IncidentEvent[]> {
  const { client } = await createOrgScopedClient()
  const { data, error } = await client
    .from('incident_events')
    .select()
    .eq('incident_id', incidentId)
    .order('occurred_at', { ascending: true })
  if (error) throw error
  return data.sort(
    (a, b) =>
      Date.parse(a.occurred_at) - Date.parse(b.occurred_at) ||
      (EVENT_ORDER[a.event_type] ?? 9) - (EVENT_ORDER[b.event_type] ?? 9),
  )
}

/** Incident history for one monitor, newest outage first. */
export async function listMonitorIncidents(
  monitorId: string,
): Promise<IncidentListItem[]> {
  const { client } = await createOrgScopedClient()
  const { data, error } = await client
    .from('incidents')
    .select('*, monitors(name), incident_events(event_type)')
    .eq('monitor_id', monitorId)
    .order('opened_at', { ascending: false })
  if (error) throw error
  return data.map(toListItem)
}

/** Open incident count for the active org, for the dashboard overview. */
export async function countOpenIncidents(): Promise<number> {
  const { client } = await createOrgScopedClient()
  const { count, error } = await client
    .from('incidents')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'open')
  if (error) throw error
  return count ?? 0
}
