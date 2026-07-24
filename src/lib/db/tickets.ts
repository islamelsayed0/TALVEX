import { auth } from '@clerk/nextjs/server'

import { getActiveOrgViewer, type OrgViewer } from '@/lib/auth/org-viewer'
import { createOrgScopedClient } from './client'
import { OrgNotSyncedError } from './monitors'
import type { Ticket, TicketComment, TicketEvent, TicketStatus } from './types'

/**
 * Typed data layer for tickets (CLAUDE.md code rule 7). Everything here runs
 * on the org scoped client, so RLS has already applied both the org boundary
 * and the role rule before any code below sees a row: members get only
 * tickets they submitted, org admins (per org_members.role) get the whole
 * org. Nothing in this file re-implements that rule; the database is the
 * authority and this layer just asks.
 *
 * Writes users can perform: create a ticket, comment on a visible ticket,
 * and (admins only, enforced by RLS) change status. The activity trail in
 * ticket_events is written by database triggers and the cron sweep only;
 * this module reads it and can never write it.
 */

/** User input failed validation; message is safe to show as form feedback. */
export class TicketValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TicketValidationError'
  }
}

export const TICKET_STATUSES: readonly TicketStatus[] = [
  'open',
  'in_progress',
  'resolved',
  'closed',
]

export function isTicketStatus(value: string): value is TicketStatus {
  return (TICKET_STATUSES as readonly string[]).includes(value)
}

export type TicketInput = {
  title: string
  description: string
  /**
   * The incident this ticket is created from, when it is (Task 4). Optional
   * and NULL for ordinary tickets. RLS pins it to an incident in the same
   * org, so a value from another org is refused at insert.
   */
  incidentId?: string | null
}

/** @deprecated Use OrgViewer from @/lib/auth/org-viewer. Kept as an alias so
 * existing ticket screens need no churn. */
export type TicketViewer = OrgViewer

/** One trail entry: a user comment or a system event, ready to interleave. */
export type TrailItem =
  | { kind: 'comment'; at: string; comment: TicketComment }
  | { kind: 'event'; at: string; event: TicketEvent }

const TITLE_MAX = 200
const BODY_MAX = 10_000

function validated(input: TicketInput): { title: string; description: string } {
  const title = input.title.trim()
  const description = input.description.trim()
  if (title === '') {
    throw new TicketValidationError('Give your request a short summary.')
  }
  if (title.length > TITLE_MAX) {
    throw new TicketValidationError('Keep the summary under 200 characters.')
  }
  if (description === '') {
    throw new TicketValidationError('Tell us a little about the problem.')
  }
  if (description.length > BODY_MAX) {
    throw new TicketValidationError(
      'That description is very long. Keep it under 10,000 characters.',
    )
  }
  return { title, description }
}

/**
 * Queue order (Task 3 ruling): open first with the oldest at the top, so the
 * longest waiting request is the first thing seen. In progress follows the
 * same oldest first rule, then resolved and closed, newest first, since
 * recent history matters more than old.
 */
const STATUS_RANK: Record<TicketStatus, number> = {
  open: 0,
  in_progress: 1,
  resolved: 2,
  closed: 3,
}

export function sortTicketsForQueue(tickets: Ticket[]): Ticket[] {
  const rank = (t: Ticket) => STATUS_RANK[t.status as TicketStatus] ?? 9
  const settledAt = (t: Ticket) =>
    Date.parse(t.closed_at ?? t.resolved_at ?? t.created_at)
  return [...tickets].sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b)
    if (rank(a) <= 1) return Date.parse(a.created_at) - Date.parse(b.created_at)
    return settledAt(b) - settledAt(a)
  })
}

/**
 * Comments and system events, one chronological stream. Stored distinctly by
 * ruling; interleaved here for rendering. On a timestamp tie the system
 * event comes first, so "created" always opens the trail.
 */
export function interleaveTrail(
  comments: TicketComment[],
  events: TicketEvent[],
): TrailItem[] {
  const items: TrailItem[] = [
    ...events.map((event): TrailItem => ({ kind: 'event', at: event.occurred_at, event })),
    ...comments.map((comment): TrailItem => ({ kind: 'comment', at: comment.created_at, comment })),
  ]
  return items.sort(
    (a, b) =>
      Date.parse(a.at) - Date.parse(b.at) ||
      (a.kind === b.kind ? 0 : a.kind === 'event' ? -1 : 1),
  )
}

/**
 * Who is looking, per the database: the Clerk user id from the session and
 * whether their org_members row for the active org is admin grade. The UI
 * uses this to decide what to render; RLS enforces the same answer on every
 * query regardless.
 */
export async function getTicketViewer(): Promise<TicketViewer> {
  return getActiveOrgViewer()
}

/**
 * The tickets this session may see, in queue order. For a member that is
 * their own submissions; for an admin, the whole org. Optionally narrowed to
 * one status (the admin queue filters).
 */
export async function listTickets(status?: TicketStatus): Promise<Ticket[]> {
  const { client } = await createOrgScopedClient()
  let query = client.from('tickets').select()
  if (status) query = query.eq('status', status)
  const { data, error } = await query
  if (error) throw error
  return sortTicketsForQueue(data)
}

/** One ticket by id, or null when this session cannot see it. */
export async function getTicket(id: string): Promise<Ticket | null> {
  const { client } = await createOrgScopedClient()
  const { data, error } = await client
    .from('tickets')
    .select()
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data
}

/** Comments on one ticket, chronological. */
export async function listTicketComments(
  ticketId: string,
): Promise<TicketComment[]> {
  const { client } = await createOrgScopedClient()
  const { data, error } = await client
    .from('ticket_comments')
    .select()
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data
}

/** The system trail of one ticket, chronological. */
export async function listTicketEvents(
  ticketId: string,
): Promise<TicketEvent[]> {
  const { client } = await createOrgScopedClient()
  const { data, error } = await client
    .from('ticket_events')
    .select()
    .eq('ticket_id', ticketId)
    .order('occurred_at', { ascending: true })
  if (error) throw error
  return data
}

/**
 * Submit a ticket as the signed in user. Status is not sent: every ticket is
 * born open by the column default, and the insert grant does not even
 * include the status column. The created trail event is written by the
 * database trigger, not here.
 */
export async function createTicket(input: TicketInput): Promise<Ticket> {
  const row = validated(input)
  const { client, orgId } = await createOrgScopedClient()
  const { userId } = await auth()
  if (!userId) throw new Error('No signed in user on this session.')

  const { data: org, error: orgError } = await client
    .from('organizations')
    .select('id')
    .eq('clerk_org_id', orgId)
    .maybeSingle()
  if (orgError) throw orgError
  if (!org) throw new OrgNotSyncedError()

  // incident_id is passed through only when present. RLS refuses a value that
  // does not belong to this org, so a bad or forged id fails the insert
  // rather than linking to a stranger's incident.
  const incidentId = input.incidentId?.trim() || null

  const { data, error } = await client
    .from('tickets')
    .insert({
      ...row,
      org_id: org.id,
      submitted_by: userId,
      incident_id: incidentId,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

/**
 * Tickets created from one incident, for the incident detail page. RLS scopes
 * the result to what this session may see: a member gets the linked tickets
 * they submitted, an admin gets all of them. Newest first, so the most recent
 * response to the outage is at the top.
 */
export async function listTicketsForIncident(
  incidentId: string,
): Promise<Ticket[]> {
  const { client } = await createOrgScopedClient()
  const { data, error } = await client
    .from('tickets')
    .select()
    .eq('incident_id', incidentId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

/**
 * Comment on a ticket this session can see. Returns null when the ticket is
 * not visible (treated like not found). The closed check here is for a
 * friendly message only; the insert policy enforces it regardless.
 */
export async function addTicketComment(
  ticketId: string,
  body: string,
): Promise<TicketComment | null> {
  const trimmed = body.trim()
  if (trimmed === '') {
    throw new TicketValidationError('Write something before sending.')
  }
  if (trimmed.length > BODY_MAX) {
    throw new TicketValidationError(
      'That comment is very long. Keep it under 10,000 characters.',
    )
  }

  const ticket = await getTicket(ticketId)
  if (!ticket) return null
  if (ticket.status === 'closed') {
    throw new TicketValidationError(
      'This ticket is closed and does not take new comments.',
    )
  }

  const { client } = await createOrgScopedClient()
  const { userId } = await auth()
  if (!userId) throw new Error('No signed in user on this session.')

  const { data, error } = await client
    .from('ticket_comments')
    .insert({
      org_id: ticket.org_id,
      ticket_id: ticket.id,
      author: userId,
      body: trimmed,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

/**
 * Change a ticket's status. RLS makes this admin only: for anyone else the
 * update matches zero rows and null comes back, indistinguishable from a
 * ticket that does not exist. Timestamps and the trail event are written by
 * the database triggers, never from here.
 */
export async function updateTicketStatus(
  id: string,
  status: TicketStatus,
): Promise<Ticket | null> {
  const { client } = await createOrgScopedClient()
  const { data, error } = await client
    .from('tickets')
    .update({ status })
    .eq('id', id)
    .select()
    .maybeSingle()
  if (error) {
    // The lifecycle trigger refuses any transition out of closed. Reaching
    // this normally means a stale form raced the auto close sweep.
    if (error.message.includes('closed tickets are final')) {
      throw new TicketValidationError(
        'This ticket is closed. Closed tickets keep their status.',
      )
    }
    throw error
  }
  return data
}
