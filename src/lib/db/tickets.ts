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
  'canceled',
]

/** The end states. A ticket in one of these has stopped needing attention;
 * neither is locked, and both are reachable back out of by an admin. */
export const TERMINAL_TICKET_STATUSES: readonly TicketStatus[] = [
  'resolved',
  'canceled',
]

export function isTicketStatus(value: string): value is TicketStatus {
  return (TICKET_STATUSES as readonly string[]).includes(value)
}

export function isTerminalTicketStatus(status: string): boolean {
  return (TERMINAL_TICKET_STATUSES as readonly string[]).includes(status)
}

/**
 * The transitions a requester may drive on their OWN ticket, as the database
 * enforces them (migration 019, member_set_ticket_status). Restated here only
 * so the UI can decide which buttons to render; it is not the authority and
 * disagreeing with it changes nothing, because the function refuses anyway.
 */
export const MEMBER_TRANSITIONS: Readonly<
  Record<TicketStatus, readonly TicketStatus[]>
> = {
  open: ['resolved', 'canceled'],
  in_progress: ['resolved', 'canceled'],
  resolved: ['open'],
  // Terminal for the requester. A problem coming back is a new ticket, not a
  // resurrection of a withdrawal.
  canceled: [],
}

export function memberCanMove(from: string, to: TicketStatus): boolean {
  const allowed = MEMBER_TRANSITIONS[from as TicketStatus]
  return allowed !== undefined && allowed.includes(to)
}

/** How long a settled ticket stays on the requester's default list. */
export const MEMBER_LIST_TERMINAL_DAYS = 7

export type TicketInput = {
  title: string
  description: string
  /**
   * The incident this ticket is created from, when it is (Task 4). Optional
   * and NULL for ordinary tickets. RLS pins it to an incident in the same
   * org, so a value from another org is refused at insert.
   */
  incidentId?: string | null
  /**
   * The chat conversation this ticket is escalated from, when it is (Task 5).
   * Optional and NULL for ordinary tickets. RLS pins it to a conversation the
   * caller can see in the same org, exactly like incidentId. A ticket carries
   * at most one origin (the tickets_single_origin check), so this and
   * incidentId are never both set.
   */
  conversationId?: string | null
}

/** @deprecated Use OrgViewer from @/lib/auth/org-viewer. Kept as an alias so
 * existing ticket screens need no churn. */
export type TicketViewer = OrgViewer

/**
 * One trail entry: a user comment or a system event, ready to interleave.
 *
 * Generic over both row shapes, defaulting to the full rows the ticket detail
 * page renders. The daily digest reads the same trail to decide whether a
 * ticket is waiting on a reply, but deliberately selects no comment bodies
 * (emails never carry content), so it interleaves narrower rows. Parameterising
 * the type is what lets both reuse one definition of what a trail is.
 */
export type TrailItem<C = TicketComment, E = TicketEvent> =
  | { kind: 'comment'; at: string; comment: C }
  | { kind: 'event'; at: string; event: E }

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
 * same oldest first rule, then the settled ones newest first, since recent
 * history matters more than old.
 *
 * Canceled ranks below resolved. A withdrawal is the least likely thing an
 * admin needs to look at, and putting it last keeps it out of the way without
 * hiding it, which is the whole posture toward canceled in this feature: it is
 * not a failure and it is not a secret, it is just finished.
 */
const STATUS_RANK: Record<TicketStatus, number> = {
  open: 0,
  in_progress: 1,
  resolved: 2,
  canceled: 3,
}

export function sortTicketsForQueue(tickets: Ticket[]): Ticket[] {
  const rank = (t: Ticket) => STATUS_RANK[t.status as TicketStatus] ?? 9
  // closed_at is gone with the state (migration 019). A canceled ticket has no
  // timestamp of its own by design, so it sorts on when it was raised.
  const settledAt = (t: Ticket) => Date.parse(t.resolved_at ?? t.created_at)
  return [...tickets].sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b)
    if (rank(a) <= 1) return Date.parse(a.created_at) - Date.parse(b.created_at)
    return settledAt(b) - settledAt(a)
  })
}

/**
 * When a ticket last entered a terminal state, read from its own trail.
 *
 * The trail is the authority rather than a column, deliberately (migration
 * 019). Every transition is already recorded there with its time, so a
 * settled_at column would be a second copy of a fact that can drift from the
 * first. Returns null when the trail carries no terminal transition, which is
 * the honest answer for a ticket that has never settled.
 *
 * Reads backwards and stops at the first terminal arrival, so a ticket that
 * was resolved, reopened, and resolved again reports the LATEST settling.
 */
export function terminalTransitionAtMs(
  events: { event_type: string; detail: string | null; occurred_at: string }[],
): number | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (event.event_type !== 'status_changed') continue
    const detail = event.detail ?? ''
    // The trail writer renders underscores as spaces, so in_progress reads
    // "in progress". Matching on the rendered form is matching what is stored.
    const to = / to ([a-z ]+)\.$/.exec(detail)?.[1]
    if (to === undefined) continue
    if (to === 'resolved' || to === 'canceled') {
      return Date.parse(event.occurred_at)
    }
    // The most recent status change moved it OUT of a terminal state, so it is
    // not settled now whatever happened before.
    return null
  }
  return null
}

/**
 * The requester's default list rule: a settled ticket drops off once it has
 * been settled longer than the window, and a ticket the requester removed
 * drops off immediately. Anything unsettled always stays, however old.
 */
export function isHiddenFromMemberList(
  ticket: { status: string; hidden_by_requester: boolean },
  terminalAtMs: number | null,
  nowMs: number,
): boolean {
  if (ticket.hidden_by_requester) return true
  if (!isTerminalTicketStatus(ticket.status)) return false
  if (terminalAtMs === null) return false
  return nowMs - terminalAtMs > MEMBER_LIST_TERMINAL_DAYS * 24 * 60 * 60 * 1000
}

/**
 * Comments and system events, one chronological stream. Stored distinctly by
 * ruling; interleaved here for rendering. On a timestamp tie the system
 * event comes first, so "created" always opens the trail.
 */
export function interleaveTrail<
  C extends { created_at: string },
  E extends { occurred_at: string },
>(comments: C[], events: E[]): TrailItem<C, E>[] {
  const items: TrailItem<C, E>[] = [
    ...events.map((event): TrailItem<C, E> => ({ kind: 'event', at: event.occurred_at, event })),
    ...comments.map((comment): TrailItem<C, E> => ({ kind: 'comment', at: comment.created_at, comment })),
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

/**
 * The requester's own list, with the hygiene rule applied.
 *
 * RLS has already narrowed this to tickets this session may see, so for a
 * member that is their own submissions and nothing else. What this adds is the
 * default view: settled longer than the window, or removed by hand, drops off.
 * `showAll` returns everything of theirs, which is what the Show all toggle
 * asks for; nothing is ever deleted or moved either way.
 *
 * The terminal time comes from the trail (terminalTransitionAtMs), fetched for
 * every candidate ticket in ONE query rather than one per ticket.
 */
export async function listTicketsForRequester(
  showAll = false,
  nowMs = Date.now(),
): Promise<{ tickets: Ticket[]; hiddenCount: number }> {
  const { client } = await createOrgScopedClient()
  const { data, error } = await client.from('tickets').select()
  if (error) throw error

  const settled = data.filter((t) => isTerminalTicketStatus(t.status))
  const terminalAt = new Map<string, number | null>()
  if (settled.length > 0) {
    const { data: events, error: eventsError } = await client
      .from('ticket_events')
      .select('ticket_id, event_type, detail, occurred_at')
      .in(
        'ticket_id',
        settled.map((t) => t.id),
      )
      .order('occurred_at', { ascending: true })
    if (eventsError) throw eventsError
    for (const ticket of settled) {
      terminalAt.set(
        ticket.id,
        terminalTransitionAtMs(events.filter((e) => e.ticket_id === ticket.id)),
      )
    }
  }

  const visible = data.filter(
    (t) => !isHiddenFromMemberList(t, terminalAt.get(t.id) ?? null, nowMs),
  )
  return {
    tickets: sortTicketsForQueue(showAll ? data : visible),
    hiddenCount: data.length - visible.length,
  }
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

  // incident_id and conversation_id are passed through only when present. RLS
  // refuses a value that does not belong to this org, so a bad or forged id
  // fails the insert rather than linking to a stranger's incident or chat. A
  // ticket carries at most one origin (the tickets_single_origin check).
  const incidentId = input.incidentId?.trim() || null
  const conversationId = input.conversationId?.trim() || null

  const { data, error } = await client
    .from('tickets')
    .insert({
      ...row,
      org_id: org.id,
      submitted_by: userId,
      incident_id: incidentId,
      conversation_id: conversationId,
    })
    .select()
    .single()
  if (error) throw error

  // A ticket escalated from a chat marks that conversation escalated, so the
  // conversation shows "your IT team has this now" and takes no more messages.
  // The caller is the conversation's creator, so this update passes RLS; if it
  // ever matches zero rows the ticket still stands.
  if (conversationId) {
    await client
      .from('chat_conversations')
      .update({ status: 'escalated' })
      .eq('id', conversationId)
  }

  return data
}

/**
 * The ticket a conversation was escalated into, or null. RLS scopes it to what
 * this session may see: the member who escalated sees their own ticket, an
 * admin sees it too. Used by the conversation detail to link through after
 * escalation, and there is at most one because an escalated conversation takes
 * no further messages and cannot escalate twice.
 */
export async function getTicketForConversation(
  conversationId: string,
): Promise<Ticket | null> {
  const { client } = await createOrgScopedClient()
  const { data, error } = await client
    .from('tickets')
    .select()
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
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
  isInternal = false,
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

  const { client } = await createOrgScopedClient()
  const { userId } = await auth()
  if (!userId) throw new Error('No signed in user on this session.')

  // is_internal true is admin only at the database (migration 019). Nothing
  // here checks the role: a member posting is_internal by hand is refused by
  // the insert policy, which is the only place that rule lives.
  const { data, error } = await client
    .from('ticket_comments')
    .insert({
      org_id: ticket.org_id,
      ticket_id: ticket.id,
      author: userId,
      body: trimmed,
      is_internal: isInternal,
    })
    .select()
    .single()
  if (error) {
    if (error.code === '42501') {
      throw new TicketValidationError(
        'Internal notes can only be added by an admin.',
      )
    }
    throw error
  }
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
  if (error) throw error
  return data
}

/**
 * A requester's own lifecycle action: resolve, cancel, or reopen.
 *
 * Goes through member_set_ticket_status (migration 019) rather than an update,
 * because members hold no update verb on tickets at all. The function is the
 * authority on which transitions exist and on the reopen explanation; this
 * wrapper only translates its refusals into something a form can show.
 *
 * Reopening writes the explanation as the member's own comment inside the same
 * transaction, so a status change without its explanation cannot be produced
 * by any sequence of calls from here.
 */
export async function memberSetTicketStatus(
  ticketId: string,
  status: TicketStatus,
  explanation?: string,
): Promise<void> {
  const { client } = await createOrgScopedClient()
  const { error } = await client.rpc('member_set_ticket_status', {
    p_ticket_id: ticketId,
    p_status: status,
    // The generated argument type is optional rather than nullable, so an
    // absent explanation is omitted rather than sent as null. The function
    // defaults it either way.
    ...(explanation ? { p_explanation: explanation } : {}),
  })
  if (!error) return

  if (error.message.includes('needs an explanation')) {
    throw new TicketValidationError(
      'Tell your IT team what is still wrong, so they know where to pick it up.',
    )
  }
  if (error.message.includes('too long')) {
    throw new TicketValidationError('Keep that under 10,000 characters.')
  }
  if (error.message.includes('cannot move a ticket')) {
    throw new TicketValidationError(
      'That is no longer possible for this request. Refresh the page to see where it stands.',
    )
  }
  if (error.message.includes('ticket not found')) {
    throw new TicketValidationError('That request is no longer available.')
  }
  throw error
}

/** The requester removes their own settled ticket from their own list. */
export async function memberHideTicket(ticketId: string): Promise<void> {
  const { client } = await createOrgScopedClient()
  const { error } = await client.rpc('member_hide_ticket', {
    p_ticket_id: ticketId,
  })
  if (!error) return
  if (
    error.message.includes('can be removed from your list') ||
    error.message.includes('ticket not found')
  ) {
    throw new TicketValidationError(
      'Only a finished request can be removed from your list.',
    )
  }
  throw error
}
