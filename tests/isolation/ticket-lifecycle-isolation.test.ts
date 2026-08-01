import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  CLAIM_SHAPES,
  createMemberClient,
  createServiceClient,
  memberToken,
  preflight,
  type ClaimShape,
  type TestClient,
} from './local-stack'

// The ticket lifecycle proof (migration 019), extending the suite per
// CLAUDE.md rules 2 and 8.
//
// This file exists because this is the FIRST member write path onto ticket
// status. Everything a member can now do to a shared record is proved here
// against a real Postgres, and, more importantly, everything they cannot.
//
// The shape of the thing under test matters for reading these cases. Members
// hold NO update verb on public.tickets: migration 005's update policy is
// admin only and migration 019 did not widen it. Their entire write path is
// two SECURITY DEFINER functions, member_set_ticket_status and
// member_hide_ticket, which take a ticket id and nothing else that could
// reach a column. So "a member cannot change the title" is not a predicate
// being tight enough here, it is the absence of any route, and the direct
// update cases below assert that absence rather than assuming it.

const runId = randomUUID()

const seed = {
  orgA: { clerk_org_id: `org_life_a_${runId}`, name: 'Lifecycle Org A' },
  orgB: { clerk_org_id: `org_life_b_${runId}`, name: 'Lifecycle Org B' },
  /** Org A member, submits everything below unless stated. */
  member: `user_life_a1_${runId}`,
  /** Org A member, submits nothing. Must never reach the first member's rows. */
  other: `user_life_a2_${runId}`,
  /** Org A admin by column, plain member by claim. */
  admin: `user_life_admin_${runId}`,
  /** Org B member. Must never reach anything of A. */
  outsider: `user_life_b_${runId}`,
}

let service: TestClient
let orgAId: string
let orgBId: string
let seeded = false

const asUser = (clerkUserId: string, clerkOrgId: string, shape: ClaimShape) =>
  createMemberClient(memberToken({ clerkUserId, clerkOrgId, shape }))

const asMember = (shape: ClaimShape = 'legacy') =>
  asUser(seed.member, seed.orgA.clerk_org_id, shape)
const asOther = (shape: ClaimShape = 'legacy') =>
  asUser(seed.other, seed.orgA.clerk_org_id, shape)
// The admin's TOKEN claims plain member; only org_members.role says admin, so
// every admin capability below is proved to come from the column.
const asAdmin = (shape: ClaimShape = 'legacy') =>
  asUser(seed.admin, seed.orgA.clerk_org_id, shape)
const asOutsider = (shape: ClaimShape = 'legacy') =>
  asUser(seed.outsider, seed.orgB.clerk_org_id, shape)

/** A fresh open ticket submitted by the given user, through their own RLS
 * session, which is the real write path. */
async function newTicket(
  client: TestClient,
  orgId: string,
  submittedBy: string,
  title: string,
): Promise<string> {
  const { data, error } = await client
    .from('tickets')
    .insert({
      org_id: orgId,
      submitted_by: submittedBy,
      title,
      description: 'Seeded by the lifecycle isolation suite.',
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`Seeding ticket failed: ${error?.message}`)
  return data.id
}

async function statusOf(ticketId: string): Promise<string> {
  const { data } = await service
    .from('tickets')
    .select('status')
    .eq('id', ticketId)
    .single()
  return data!.status
}

async function trailOf(ticketId: string) {
  const { data } = await service
    .from('ticket_events')
    .select('event_type, actor, detail, occurred_at')
    .eq('ticket_id', ticketId)
    .order('occurred_at', { ascending: true })
  return data ?? []
}

async function auditFor(ticketId: string) {
  const { data } = await service
    .from('audit_log')
    .select('action, actor, detail')
    .eq('org_id', orgAId)
    .order('occurred_at', { ascending: true })
  return (data ?? []).filter(
    (row) =>
      typeof row.detail === 'object' &&
      row.detail !== null &&
      (row.detail as Record<string, unknown>).ticket_id === ticketId,
  )
}

beforeAll(async () => {
  await preflight()
  service = createServiceClient()

  const { data: orgs, error: orgErr } = await service
    .from('organizations')
    .insert([seed.orgA, seed.orgB])
    .select()
  if (orgErr || orgs.length !== 2) {
    throw new Error(`Seeding organizations failed: ${orgErr?.message}`)
  }
  orgAId = orgs.find((o) => o.clerk_org_id === seed.orgA.clerk_org_id)!.id
  orgBId = orgs.find((o) => o.clerk_org_id === seed.orgB.clerk_org_id)!.id

  const { error: memberErr } = await service.from('org_members').insert([
    { org_id: orgAId, clerk_user_id: seed.member, role: 'member' },
    { org_id: orgAId, clerk_user_id: seed.other, role: 'member' },
    { org_id: orgAId, clerk_user_id: seed.admin, role: 'admin' },
    { org_id: orgBId, clerk_user_id: seed.outsider, role: 'member' },
  ])
  if (memberErr) throw new Error(`Seeding org_members failed: ${memberErr.message}`)

  seeded = true
})

afterAll(async () => {
  if (!seeded) return
  await service.from('organizations').delete().in('id', [orgAId, orgBId])
})

// ---------------------------------------------------------------------------

describe('the transitions a requester may drive on their own ticket', () => {
  it('resolves an open ticket, in both claim shapes', async () => {
    for (const shape of CLAIM_SHAPES) {
      const id = await newTicket(
        asMember(shape),
        orgAId,
        seed.member,
        `resolve ${shape}`,
      )
      const { error } = await asMember(shape).rpc('member_set_ticket_status', {
        p_ticket_id: id,
        p_status: 'resolved',
      })
      expect(error, `resolve should be allowed for ${shape}`).toBeNull()
      expect(await statusOf(id)).toBe('resolved')
    }
  })

  it('resolves from in_progress too: an admin picking it up does not take the button away', async () => {
    const id = await newTicket(asMember(), orgAId, seed.member, 'resolve from wip')
    await asAdmin().from('tickets').update({ status: 'in_progress' }).eq('id', id)

    const { error } = await asMember().rpc('member_set_ticket_status', {
      p_ticket_id: id,
      p_status: 'resolved',
    })
    expect(error).toBeNull()
    expect(await statusOf(id)).toBe('resolved')
  })

  it('cancels an open ticket', async () => {
    const id = await newTicket(asMember(), orgAId, seed.member, 'cancel')
    const { error } = await asMember().rpc('member_set_ticket_status', {
      p_ticket_id: id,
      p_status: 'canceled',
    })
    expect(error).toBeNull()
    expect(await statusOf(id)).toBe('canceled')
  })

  it('reopens a resolved ticket, and the explanation lands as their own comment', async () => {
    const id = await newTicket(asMember(), orgAId, seed.member, 'reopen')
    await asMember().rpc('member_set_ticket_status', {
      p_ticket_id: id,
      p_status: 'resolved',
    })

    const { error } = await asMember().rpc('member_set_ticket_status', {
      p_ticket_id: id,
      p_status: 'open',
      p_explanation: 'It started again this morning.',
    })
    expect(error).toBeNull()
    expect(await statusOf(id)).toBe('open')

    // The whole reason this is a function and not an update: the status change
    // and the explanation are one transaction, so neither can exist alone.
    const { data: comments } = await service
      .from('ticket_comments')
      .select('author, body, is_internal')
      .eq('ticket_id', id)
    expect(comments).toEqual([
      {
        author: seed.member,
        body: 'It started again this morning.',
        is_internal: false,
      },
    ])
  })
})

describe('the transitions a requester may not drive', () => {
  it('refuses to reopen without an explanation, and changes nothing', async () => {
    const id = await newTicket(asMember(), orgAId, seed.member, 'reopen bare')
    await asMember().rpc('member_set_ticket_status', {
      p_ticket_id: id,
      p_status: 'resolved',
    })

    for (const explanation of [undefined, '', '   ']) {
      const { error } = await asMember().rpc('member_set_ticket_status', {
        p_ticket_id: id,
        p_status: 'open',
        ...(explanation === undefined ? {} : { p_explanation: explanation }),
      })
      expect(error, `"${explanation}" must be refused`).not.toBeNull()
    }
    expect(await statusOf(id)).toBe('resolved')

    const { data: comments } = await service
      .from('ticket_comments')
      .select('id')
      .eq('ticket_id', id)
    expect(comments).toEqual([])
  })

  it('refuses in_progress: that is admin signal, not a requester action', async () => {
    const id = await newTicket(asMember(), orgAId, seed.member, 'no wip')
    const { error } = await asMember().rpc('member_set_ticket_status', {
      p_ticket_id: id,
      p_status: 'in_progress',
    })
    expect(error).not.toBeNull()
    expect(await statusOf(id)).toBe('open')
  })

  it('refuses a made up status', async () => {
    const id = await newTicket(asMember(), orgAId, seed.member, 'no nonsense')
    const { error } = await asMember().rpc('member_set_ticket_status', {
      p_ticket_id: id,
      p_status: 'archived',
    })
    expect(error).not.toBeNull()
    expect(await statusOf(id)).toBe('open')
  })

  it('refuses cancel on a resolved ticket: you cannot withdraw something already done', async () => {
    const id = await newTicket(asMember(), orgAId, seed.member, 'no late cancel')
    await asMember().rpc('member_set_ticket_status', {
      p_ticket_id: id,
      p_status: 'resolved',
    })
    const { error } = await asMember().rpc('member_set_ticket_status', {
      p_ticket_id: id,
      p_status: 'canceled',
    })
    expect(error).not.toBeNull()
    expect(await statusOf(id)).toBe('resolved')
  })

  it('treats canceled as terminal: no requester transition leaves it', async () => {
    const id = await newTicket(asMember(), orgAId, seed.member, 'canceled is final')
    await asMember().rpc('member_set_ticket_status', {
      p_ticket_id: id,
      p_status: 'canceled',
    })

    for (const target of ['open', 'in_progress', 'resolved', 'canceled']) {
      const { error } = await asMember().rpc('member_set_ticket_status', {
        p_ticket_id: id,
        p_status: target,
        p_explanation: 'let me back in',
      })
      expect(error, `canceled to ${target} must be refused`).not.toBeNull()
    }
    expect(await statusOf(id)).toBe('canceled')
  })

  it('produces no trail row for a refused no op, so a redundant press forges nothing', async () => {
    const id = await newTicket(asMember(), orgAId, seed.member, 'no op')
    await asMember().rpc('member_set_ticket_status', {
      p_ticket_id: id,
      p_status: 'resolved',
    })
    const before = await trailOf(id)

    // Resolve it again, three times. Each must be refused outright.
    for (let i = 0; i < 3; i++) {
      const { error } = await asMember().rpc('member_set_ticket_status', {
        p_ticket_id: id,
        p_status: 'resolved',
      })
      expect(error).not.toBeNull()
    }

    expect(await trailOf(id)).toEqual(before)
  })
})

describe('other people, and other organizations', () => {
  it("refuses a member acting on another member's ticket in the same org", async () => {
    const id = await newTicket(asMember(), orgAId, seed.member, 'not yours')
    for (const status of ['resolved', 'canceled']) {
      const { error } = await asOther().rpc('member_set_ticket_status', {
        p_ticket_id: id,
        p_status: status,
      })
      expect(error, `${status} by a stranger must be refused`).not.toBeNull()
    }
    expect(await statusOf(id)).toBe('open')
  })

  it('refuses an admin using the requester path on somebody else s ticket', async () => {
    // Admins have their own update policy. This function is scoped to the
    // person who submitted the ticket and stays that way for everyone.
    const id = await newTicket(asMember(), orgAId, seed.member, 'admin not requester')
    const { error } = await asAdmin().rpc('member_set_ticket_status', {
      p_ticket_id: id,
      p_status: 'canceled',
    })
    expect(error).not.toBeNull()
    expect(await statusOf(id)).toBe('open')
  })

  it('refuses a member of another org, in both claim shapes', async () => {
    const id = await newTicket(asMember(), orgAId, seed.member, 'cross org')
    for (const shape of CLAIM_SHAPES) {
      const { error } = await asOutsider(shape).rpc('member_set_ticket_status', {
        p_ticket_id: id,
        p_status: 'canceled',
      })
      expect(error, `cross org ${shape} must be refused`).not.toBeNull()
    }
    expect(await statusOf(id)).toBe('open')

    // And the ticket was never visible to them in the first place: empty, not
    // an error, exactly as every other cross org read in this suite.
    const { data, error: readError } = await asOutsider()
      .from('tickets')
      .select()
      .eq('id', id)
    expect(readError).toBeNull()
    expect(data).toEqual([])
  })
})

describe('hidden_by_requester', () => {
  it('is settable on a settled ticket, by its requester', async () => {
    const id = await newTicket(asMember(), orgAId, seed.member, 'hide me')
    await asMember().rpc('member_set_ticket_status', {
      p_ticket_id: id,
      p_status: 'canceled',
    })
    const { error } = await asMember().rpc('member_hide_ticket', {
      p_ticket_id: id,
    })
    expect(error).toBeNull()

    const { data } = await service
      .from('tickets')
      .select('hidden_by_requester, status')
      .eq('id', id)
      .single()
    // The row never moves and never disappears: one boolean changed.
    expect(data).toEqual({ hidden_by_requester: true, status: 'canceled' })
  })

  it('is refused on an open ticket: unfinished things stay on the list', async () => {
    const id = await newTicket(asMember(), orgAId, seed.member, 'still open')
    const { error } = await asMember().rpc('member_hide_ticket', {
      p_ticket_id: id,
    })
    expect(error).not.toBeNull()

    const { data } = await service
      .from('tickets')
      .select('hidden_by_requester')
      .eq('id', id)
      .single()
    expect(data).toEqual({ hidden_by_requester: false })
  })

  it('is refused on an in_progress ticket too', async () => {
    const id = await newTicket(asMember(), orgAId, seed.member, 'being worked')
    await asAdmin().from('tickets').update({ status: 'in_progress' }).eq('id', id)
    const { error } = await asMember().rpc('member_hide_ticket', {
      p_ticket_id: id,
    })
    expect(error).not.toBeNull()
  })

  it("is refused on another member's settled ticket", async () => {
    const id = await newTicket(asMember(), orgAId, seed.member, 'not yours to tidy')
    await asMember().rpc('member_set_ticket_status', {
      p_ticket_id: id,
      p_status: 'resolved',
    })
    const { error } = await asOther().rpc('member_hide_ticket', {
      p_ticket_id: id,
    })
    expect(error).not.toBeNull()
  })
})

describe('the columns a member cannot reach, because there is no path to them', () => {
  it('holds no update verb on tickets at all', async () => {
    const id = await newTicket(asMember(), orgAId, seed.member, 'no update verb')
    const { error } = await asMember()
      .from('tickets')
      .update({ status: 'resolved' })
      .eq('id', id)
    // Zero rows matched (the admin only policy) or refused outright. Either
    // way the row is untouched, which is the observable that matters.
    expect(await statusOf(id)).toBe('open')
    if (error === null) {
      const { data } = await asMember().from('tickets').select('status').eq('id', id)
      expect(data).toEqual([{ status: 'open' }])
    }
  })

  it('cannot ride the hidden flag alongside a title and a status change', async () => {
    // THE PROBE THE RULING ASKS FOR. Everything at once, on their own settled
    // ticket, where the hidden flag alone would have been legal through the
    // function.
    const id = await newTicket(asMember(), orgAId, seed.member, 'original title')
    await asMember().rpc('member_set_ticket_status', {
      p_ticket_id: id,
      p_status: 'resolved',
    })

    await asMember()
      .from('tickets')
      .update({
        hidden_by_requester: true,
        title: 'rewritten by the requester',
        status: 'open',
      })
      .eq('id', id)

    const { data } = await service
      .from('tickets')
      .select('title, status, hidden_by_requester')
      .eq('id', id)
      .single()
    expect(data).toEqual({
      title: 'original title',
      status: 'resolved',
      hidden_by_requester: false,
    })
  })

  it('cannot write ticket_events directly, so no trail entry can be forged', async () => {
    const id = await newTicket(asMember(), orgAId, seed.member, 'no forged trail')
    const { error } = await asMember().from('ticket_events').insert({
      org_id: orgAId,
      ticket_id: id,
      event_type: 'status_changed',
      actor: seed.admin,
      detail: 'Status changed from open to resolved.',
    })
    expect(error).not.toBeNull()
  })
})

describe('internal notes', () => {
  let ticketId: string

  beforeAll(async () => {
    ticketId = await newTicket(asMember(), orgAId, seed.member, 'notes')
    const { error } = await asAdmin().from('ticket_comments').insert({
      org_id: orgAId,
      ticket_id: ticketId,
      author: seed.admin,
      body: 'Swapped the cable. Third time this month, replace the dock.',
      is_internal: true,
    })
    expect(error).toBeNull()

    const visible = await asAdmin().from('ticket_comments').insert({
      org_id: orgAId,
      ticket_id: ticketId,
      author: seed.admin,
      body: 'All sorted, have a look.',
    })
    expect(visible.error).toBeNull()
  })

  it('an admin writes and reads them, in both claim shapes', async () => {
    for (const shape of CLAIM_SHAPES) {
      const { data, error } = await asAdmin(shape)
        .from('ticket_comments')
        .select('body, is_internal')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: true })
      expect(error).toBeNull()
      expect(data).toHaveLength(2)
      expect(data!.some((c) => c.is_internal)).toBe(true)
    }
  })

  it('the requester never reads one, on their own ticket, in either claim shape', async () => {
    for (const shape of CLAIM_SHAPES) {
      const { data, error } = await asMember(shape)
        .from('ticket_comments')
        .select('body, is_internal')
        .eq('ticket_id', ticketId)
      expect(error).toBeNull()
      // They see the visible comment and only that one.
      expect(data).toEqual([
        { body: 'All sorted, have a look.', is_internal: false },
      ])
    }
  })

  it('the requester cannot reach one by asking for it directly', async () => {
    // Filtering for exactly the withheld rows must still return nothing: the
    // policy is a row filter, not a column mask on a row they can see.
    const { data, error } = await asMember()
      .from('ticket_comments')
      .select('body')
      .eq('ticket_id', ticketId)
      .eq('is_internal', true)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('a member cannot write one, even on their own ticket', async () => {
    const { error } = await asMember().from('ticket_comments').insert({
      org_id: orgAId,
      ticket_id: ticketId,
      author: seed.member,
      body: 'marking my own homework',
      is_internal: true,
    })
    expect(error).not.toBeNull()

    const { data } = await service
      .from('ticket_comments')
      .select('id')
      .eq('ticket_id', ticketId)
      .eq('author', seed.member)
    expect(data).toEqual([])
  })

  it('leaves no member visible artifact anywhere, the trail included', async () => {
    // The count the requester sees must not betray that something is missing:
    // no placeholder row, no gap in the trail, nothing in ticket_events.
    const { data: trail } = await asMember()
      .from('ticket_events')
      .select('event_type, detail')
      .eq('ticket_id', ticketId)
    expect(trail).toEqual([
      { event_type: 'created', detail: 'Ticket submitted.' },
    ])

    const { count } = await asMember()
      .from('ticket_comments')
      .select('*', { count: 'exact', head: true })
      .eq('ticket_id', ticketId)
    expect(count).toBe(1)
  })

  it('a member of another org reads nothing of either kind', async () => {
    const { data, error } = await asOutsider()
      .from('ticket_comments')
      .select()
      .eq('ticket_id', ticketId)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })
})

describe('the audit log records the lifecycle, and only the lifecycle', () => {
  it('writes exactly one ticket_canceled row, with the requester as actor', async () => {
    const id = await newTicket(asMember(), orgAId, seed.member, 'audit cancel')
    const { error } = await asMember().rpc('member_set_ticket_status', {
      p_ticket_id: id,
      p_status: 'canceled',
    })
    expect(error).toBeNull()

    const rows = await auditFor(id)
    expect(rows).toHaveLength(1)
    expect(rows[0].action).toBe('ticket_canceled')
    expect(rows[0].actor).toBe(seed.member)
    expect(rows[0].detail).toMatchObject({
      from: 'open',
      to: 'canceled',
      actor_kind: 'member',
    })
  })

  it('writes exactly one ticket_reopened row, with the requester as actor', async () => {
    const id = await newTicket(asMember(), orgAId, seed.member, 'audit reopen')
    await asMember().rpc('member_set_ticket_status', {
      p_ticket_id: id,
      p_status: 'resolved',
    })
    await asMember().rpc('member_set_ticket_status', {
      p_ticket_id: id,
      p_status: 'open',
      p_explanation: 'back again',
    })

    const rows = await auditFor(id)
    const reopened = rows.filter((r) => r.action === 'ticket_reopened')
    expect(reopened).toHaveLength(1)
    expect(reopened[0].actor).toBe(seed.member)
    expect(reopened[0].detail).toMatchObject({
      from: 'resolved',
      to: 'open',
      actor_kind: 'member',
    })

    // The resolve before it is a plain status change, per the ruling.
    expect(rows.map((r) => r.action)).toEqual([
      'ticket_status_changed',
      'ticket_reopened',
    ])
  })

  it('marks an admin transition as an admin one', async () => {
    const id = await newTicket(asMember(), orgAId, seed.member, 'audit admin')
    await asAdmin().from('tickets').update({ status: 'in_progress' }).eq('id', id)

    const rows = await auditFor(id)
    expect(rows).toHaveLength(1)
    expect(rows[0].detail).toMatchObject({
      actor_kind: 'admin',
      to: 'in_progress',
    })
  })

  it('never records a comment, a note, or a title', async () => {
    const id = await newTicket(asMember(), orgAId, seed.member, 'secret title')
    await asMember().rpc('member_set_ticket_status', {
      p_ticket_id: id,
      p_status: 'resolved',
    })
    await asMember().rpc('member_set_ticket_status', {
      p_ticket_id: id,
      p_status: 'open',
      p_explanation: 'a sentence that must never be logged',
    })
    await asAdmin().from('ticket_comments').insert({
      org_id: orgAId,
      ticket_id: id,
      author: seed.admin,
      body: 'an internal note that must never be logged',
      is_internal: true,
    })

    const serialized = JSON.stringify(await auditFor(id))
    expect(serialized).not.toContain('must never be logged')
    expect(serialized).not.toContain('secret title')
    // The keys are the whole vocabulary: nothing else rides along.
    for (const row of await auditFor(id)) {
      expect(Object.keys(row.detail as object).sort()).toEqual([
        'actor_kind',
        'from',
        'ticket_id',
        'to',
      ])
    }
  })

  it('writes no audit row for an internal note: comments are not lifecycle', async () => {
    const id = await newTicket(asMember(), orgAId, seed.member, 'note only')
    await asAdmin().from('ticket_comments').insert({
      org_id: orgAId,
      ticket_id: id,
      author: seed.admin,
      body: 'just a note, no transition',
      is_internal: true,
    })
    expect(await auditFor(id)).toEqual([])
  })

  it('stays admin only to read, exactly as the rest of the log', async () => {
    const { data, error } = await asMember().from('audit_log').select()
    expect(error).toBeNull()
    expect(data).toEqual([])
  })
})
