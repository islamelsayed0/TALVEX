import 'server-only'

import { isValidStatusSlug } from '@/lib/status/status-view'

import { createAnonClient, createOrgScopedClient } from './client'
import { OrgNotSyncedError } from './monitors'

/**
 * Data layer for the public status page (BRD F9, CLAUDE.md rule 7). Two halves:
 * the anonymous public read (createAnonClient, no session), which the RLS
 * policies in migration 011 constrain to opted-in orgs and narrow columns; and
 * the admin settings read and save (org scoped client), gated by the admin
 * update policy on organizations. The database is the boundary either way.
 */

export type PublicStatusMonitor = {
  id: string
  name: string
  last_status: 'up' | 'down' | null
}
export type PublicStatusRollup = {
  monitor_id: string
  day: string
  uptime_percent: number
  check_count: number
}
export type PublicStatusIncident = {
  id: string
  monitor_id: string
  status: string
  opened_at: string
  resolved_at: string | null
}
export type PublicStatusPage = {
  org: { id: string; name: string; slug: string }
  monitors: PublicStatusMonitor[]
  rollups: PublicStatusRollup[]
  incidents: PublicStatusIncident[]
}

const HEATMAP_DAYS = 90
const INCIDENT_DAYS = 30

function utcCutoffDate(daysAgo: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - daysAgo)
  return d.toISOString().slice(0, 10)
}
function utcCutoffTimestamp(daysAgo: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - daysAgo)
  return d.toISOString()
}

/**
 * The public status page for a slug, or null when the slug is unknown OR the
 * page is disabled: the anon RLS returns rows only for opted-in orgs, so both
 * cases are the same empty result, and the route renders one 404 for each. Runs
 * entirely as the anon role.
 */
export async function getStatusPage(slug: string): Promise<PublicStatusPage | null> {
  const anon = createAnonClient()

  const { data: org, error: orgErr } = await anon
    .from('organizations')
    .select('id, name, status_page_slug')
    .eq('status_page_slug', slug)
    .maybeSingle()
  if (orgErr) throw orgErr
  if (!org || !org.status_page_slug) return null

  const orgId = org.id
  const [mon, roll, inc] = await Promise.all([
    anon
      .from('monitors')
      .select('id, name, last_status')
      .eq('org_id', orgId)
      .order('name', { ascending: true }),
    anon
      .from('monitor_daily_rollups')
      .select('monitor_id, day, uptime_percent, check_count')
      .eq('org_id', orgId)
      .gte('day', utcCutoffDate(HEATMAP_DAYS)),
    anon
      .from('incidents')
      .select('id, monitor_id, status, opened_at, resolved_at')
      .eq('org_id', orgId)
      .gte('opened_at', utcCutoffTimestamp(INCIDENT_DAYS))
      .order('opened_at', { ascending: false }),
  ])

  return {
    org: { id: org.id, name: org.name, slug: org.status_page_slug },
    // last_status is a checked text column, so the generated type is string.
    // The check constraint guarantees up, down, or null.
    monitors: (mon.data ?? []).map((m) => ({
      id: m.id,
      name: m.name,
      last_status: m.last_status as 'up' | 'down' | null,
    })),
    rollups: roll.data ?? [],
    incidents: inc.data ?? [],
  }
}

// ---------------------------------------------------------------------------
// Admin settings.

/** Slug or enable input failed validation. Safe to show on the settings form. */
export class StatusPageValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StatusPageValidationError'
  }
}

export type StatusPageSettings = { enabled: boolean; slug: string | null }

/** The active org's status page settings. Admin only by the org scoped client. */
export async function getStatusPageSettings(): Promise<StatusPageSettings> {
  const { client, orgId } = await createOrgScopedClient()
  const { data, error } = await client
    .from('organizations')
    .select('status_page_enabled, status_page_slug')
    .eq('clerk_org_id', orgId)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new OrgNotSyncedError()
  return { enabled: data.status_page_enabled, slug: data.status_page_slug }
}

/**
 * Validates and saves the active org's status page settings. The slug is
 * validated server side against the exact rules the check constraint enforces,
 * and a globally unique conflict comes back as a form error, not a 500. RLS
 * (migration 011) makes the write admin only; for anyone else it matches zero
 * rows. Disabling keeps the slug so re enabling restores the same URL.
 */
export async function saveStatusPageSettings(input: {
  enabled: boolean
  slug: string
}): Promise<void> {
  const slug = input.slug.trim().toLowerCase()

  if (input.enabled && slug === '') {
    throw new StatusPageValidationError(
      'Choose a slug for the status page URL before you enable it.',
    )
  }
  if (slug !== '' && !isValidStatusSlug(slug)) {
    throw new StatusPageValidationError(
      'The slug can use lowercase letters, numbers and single hyphens, 3 to 63 characters.',
    )
  }

  const finalSlug = slug === '' ? null : slug

  const { client, orgId } = await createOrgScopedClient()
  const { error } = await client
    .from('organizations')
    .update({ status_page_enabled: input.enabled, status_page_slug: finalSlug })
    .eq('clerk_org_id', orgId)

  if (error) {
    if (error.code === '23505') {
      throw new StatusPageValidationError(
        'That slug is already taken. Pick a different one.',
      )
    }
    throw error
  }
}
