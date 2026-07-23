import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  CLAIM_SHAPES,
  createMemberClient,
  createServiceClient,
  memberToken,
  orglessToken,
  preflight,
  type ClaimShape,
  type TestClient,
} from './local-stack'

// Isolation and role proof for tickets (Phase 1 Task 3), extending the
// suite per CLAUDE.md rules 2 and 8 (never skip, weaken, or delete).
//
// This file grows the suite a dimension: roles WITHIN an organization. The
// rules under test, all enforced by RLS and grants at the database:
//   - a member sees only tickets they submitted; an org admin sees every
//     ticket in the org. The authority is org_members.role, NOT the token's
//     role claim, and both directions of a claim/column disagreement are
//     asserted.
//   - any member creates tickets in their own org, as themselves, born open
//     (the insert column grant excludes status).
//   - only admins change status, and only the status column; timestamps are
//     trigger managed and closed is terminal for everyone.
//   - comments follow ticket visibility, stop at closed, and are immutable.
//   - ticket_events are written only by the triggers and the service role;
//     no user session can write them at all.
//
// Tickets are seeded through MEMBER clients on purpose: that is the real
// production write path, and it proves the insert policy while seeding.

const runId = randomUUID()

const seed = {
  orgA: { clerk_org_id: `org_tkt_a_${runId}`, name: 'Ticket Test Org A' },
  orgB: { clerk_org_id: `org_tkt_b_${runId}`, name: 'Ticket Test Org B' },
  /** Org A, plain member, submits ticketOne. */
  memberOne: `user_tkt_a1_${runId}`,
  /** Org A, plain member, submits ticketTwo. Must never see ticketOne. */
  memberTwo: `user_tkt_a2_${runId}`,
  /** Org A, org_members.role = admin. Sees and manages everything in A. */
  admin: `user_tkt_admin_${runId}`,
  /** Org B, plain member. Must never see anything of A. */
  memberB: `user_tkt_b_${runId}`,
}

let service: TestClient
let orgAId: string
let orgBId: string
let ticketOneId: string
let ticketTwoId: string
let ticketBId: string
let commentOneId: string
let seeded = false

const asUser = (
  clerkUserId: string,
  clerkOrgId: string,
  shape: ClaimShape,
  claimRole?: 'member' | 'admin',
) => createMemberClient(memberToken({ clerkUserId, clerkOrgId, shape, claimRole }))

const asMemberOne = (shape: ClaimShape) =>
  asUser(seed.memberOne, seed.orgA.clerk_org_id, shape)
const asMemberTwo = (shape: ClaimShape) =>
  asUser(seed.memberTwo, seed.orgA.clerk_org_id, shape)
// The admin's TOKEN claims plain member; only org_members.role says admin.
// Everything the admin can do below is therefore proven to come from the
// database column, never the claim.
const asAdmin = (shape: ClaimShape) =>
  asUser(seed.admin, seed.orgA.clerk_org_id, shape)
const asMemberB = (shape: ClaimShape) =>
  asUser(seed.memberB, seed.orgB.clerk_org_id, shape)

async function trailOf(ticketId: string) {
  const { data, error } = await service
    .from('ticket_events')
    .select('event_type, actor, detail')
    .eq('ticket_id', ticketId)
    .order('occurred_at', { ascending: true })
  expect(error).toBeNull()
  return data ?? []
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
    { org_id: orgAId, clerk_user_id: seed.memberOne, role: 'member' },
    { org_id: orgAId, clerk_user_id: seed.memberTwo, role: 'member' },
    { org_id: orgAId, clerk_user_id: seed.admin, role: 'admin' },
    { org_id: orgBId, clerk_user_id: seed.memberB, role: 'member' },
  ])
  if (memberErr) {
    throw new Error(`Seeding org_members failed: ${memberErr.message}`)
  }

  // Tickets go in through the real path: each member's own RLS session.
  const insertTicket = async (
    client: TestClient,
    orgId: string,
    submittedBy: string,
    title: string,
  ) => {
    const { data, error } = await client
      .from('tickets')
      .insert({
        org_id: orgId,
        submitted_by: submittedBy,
        title,
        description: `Seeded by ${title}`,
      })
      .select()
      .single()
    if (error || !data) {
      throw new Error(`Seeding ticket "${title}" failed: ${error?.message}`)
    }
    return data.id
  }

  ticketOneId = await insertTicket(
    asMemberOne('legacy'),
    orgAId,
    seed.memberOne,
    'Member one cannot print',
  )
  ticketTwoId = await insertTicket(
    asMemberTwo('v2'),
    orgAId,
    seed.memberTwo,
    'Member two forgot a password',
  )
  ticketBId = await insertTicket(
    asMemberB('legacy'),
    orgBId,
    seed.memberB,
    'Org B has a slow laptop',
  )

  // The submitter comments on their own ticket: the real comment path.
  const { data: comment, error: commentErr } = await asMemberOne('legacy')
    .from('ticket_comments')
    .insert({
      org_id: orgAId,
      ticket_id: ticketOneId,
      author: seed.memberOne,
      body: 'It worked yesterday.',
    })
    .select()
    .single()
  if (commentErr || !comment) {
    throw new Error(`Seeding comment failed: ${commentErr?.message}`)
  }
  commentOneId = comment.id

  seeded = true
}, 60_000)

afterAll(async () => {
  if (!seeded) return
  // FK cascades remove tickets, comments, and events with the orgs.
  await service
    .from('organizations')
    .delete()
    .in('clerk_org_id', [seed.orgA.clerk_org_id, seed.orgB.clerk_org_id])
})

describe('control: the seed is visible without RLS', () => {
  // Guards the suite's validity: if seeding silently failed, every "sees
  // nothing" assertion below would pass vacuously against empty tables.
  it('service role sees all three tickets, the comment, and a created event per ticket', async () => {
    const tickets = await service
      .from('tickets')
      .select('id, status')
      .in('id', [ticketOneId, ticketTwoId, ticketBId])
    expect(tickets.error).toBeNull()
    expect(tickets.data).toHaveLength(3)
    expect(tickets.data!.every((t) => t.status === 'open')).toBe(true)

    const comments = await service
      .from('ticket_comments')
      .select('id')
      .eq('id', commentOneId)
    expect(comments.data).toHaveLength(1)

    for (const id of [ticketOneId, ticketTwoId, ticketBId]) {
      expect(await trailOf(id)).toEqual([
        expect.objectContaining({ event_type: 'created' }),
      ])
    }
  })

  it('the created trail event carries the submitter as actor', async () => {
    const trail = await trailOf(ticketOneId)
    expect(trail[0]).toEqual({
      event_type: 'created',
      actor: seed.memberOne,
      detail: 'Ticket submitted.',
    })
  })
})

describe.each(CLAIM_SHAPES)(
  "cross org isolation as org B's member (%s claim shape)",
  (shape) => {
    it("listing tickets returns only B's; A's never appear", async () => {
      const { data, error } = await asMemberB(shape).from('tickets').select()
      expect(error).toBeNull()
      const ids = (data ?? []).map((t) => t.id)
      expect(ids).toContain(ticketBId)
      expect(ids).not.toContain(ticketOneId)
      expect(ids).not.toContain(ticketTwoId)
    })

    it("direct select of A's ticket, comment, and events returns empty, not an error", async () => {
      const ticket = await asMemberB(shape)
        .from('tickets')
        .select()
        .eq('id', ticketOneId)
      expect(ticket.error).toBeNull()
      expect(ticket.data).toEqual([])

      const comment = await asMemberB(shape)
        .from('ticket_comments')
        .select()
        .eq('id', commentOneId)
      expect(comment.error).toBeNull()
      expect(comment.data).toEqual([])

      for (const filter of [
        ['ticket_id', ticketOneId],
        ['org_id', orgAId],
      ] as const) {
        const events = await asMemberB(shape)
          .from('ticket_events')
          .select()
          .eq(filter[0], filter[1])
        expect(events.error).toBeNull()
        expect(events.data).toEqual([])
      }
    })

    it("cannot insert a ticket or comment carrying A's ids, and A is unchanged", async () => {
      const ticket = await asMemberB(shape).from('tickets').insert({
        org_id: orgAId,
        submitted_by: seed.memberB,
        title: 'forged into A',
        description: 'should never land',
      })
      expect(ticket.error).not.toBeNull()

      const comment = await asMemberB(shape).from('ticket_comments').insert({
        org_id: orgAId,
        ticket_id: ticketOneId,
        author: seed.memberB,
        body: 'forged comment',
      })
      expect(comment.error).not.toBeNull()

      const { data: aTickets } = await service
        .from('tickets')
        .select('id')
        .eq('org_id', orgAId)
      expect(aTickets).toHaveLength(2)
      const { data: aComments } = await service
        .from('ticket_comments')
        .select('id')
        .eq('org_id', orgAId)
      expect(aComments).toHaveLength(1)
    })

    it("cannot update A's ticket status, even with an admin CLAIM in the token", async () => {
      const { data, error } = await asUser(
        seed.memberB,
        seed.orgB.clerk_org_id,
        shape,
        'admin',
      )
        .from('tickets')
        .update({ status: 'closed' })
        .eq('id', ticketOneId)
        .select()
      expect(error).toBeNull() // zero rows matched; nothing to be denied
      expect(data).toEqual([])

      const { data: intact } = await service
        .from('tickets')
        .select('status')
        .eq('id', ticketOneId)
        .single()
      expect(intact).toEqual({ status: 'open' })
    })
  },
)

describe.each(CLAIM_SHAPES)(
  'roles within org A (%s claim shape)',
  (shape) => {
    it("member two never sees member one's ticket, by list or direct id", async () => {
      const list = await asMemberTwo(shape).from('tickets').select()
      expect(list.error).toBeNull()
      const ids = (list.data ?? []).map((t) => t.id)
      expect(ids).toEqual([ticketTwoId])

      const direct = await asMemberTwo(shape)
        .from('tickets')
        .select()
        .eq('id', ticketOneId)
      expect(direct.error).toBeNull()
      expect(direct.data).toEqual([])
    })

    it("member two sees neither the comments nor the trail of member one's ticket", async () => {
      const comments = await asMemberTwo(shape)
        .from('ticket_comments')
        .select()
        .eq('ticket_id', ticketOneId)
      expect(comments.error).toBeNull()
      expect(comments.data).toEqual([])

      const events = await asMemberTwo(shape)
        .from('ticket_events')
        .select()
        .eq('ticket_id', ticketOneId)
      expect(events.error).toBeNull()
      expect(events.data).toEqual([])
    })

    it("the admin sees both members' tickets, on a token whose CLAIM is only member", async () => {
      const { data, error } = await asAdmin(shape).from('tickets').select()
      expect(error).toBeNull()
      const ids = (data ?? []).map((t) => t.id)
      expect(ids).toContain(ticketOneId)
      expect(ids).toContain(ticketTwoId)
      expect(ids).not.toContain(ticketBId)
    })

    it('an admin CLAIM on a member does not widen visibility: org_members.role is the authority', async () => {
      const { data, error } = await asUser(
        seed.memberTwo,
        seed.orgA.clerk_org_id,
        shape,
        'admin',
      )
        .from('tickets')
        .select()
      expect(error).toBeNull()
      expect((data ?? []).map((t) => t.id)).toEqual([ticketTwoId])
    })

    it('a member cannot change status, even on their own ticket', async () => {
      const { data, error } = await asMemberOne(shape)
        .from('tickets')
        .update({ status: 'resolved' })
        .eq('id', ticketOneId)
        .select()
      expect(error).toBeNull() // the policy matches zero rows; nothing errors
      expect(data).toEqual([])

      const { data: intact } = await service
        .from('tickets')
        .select('status, resolved_at')
        .eq('id', ticketOneId)
        .single()
      expect(intact).toEqual({ status: 'open', resolved_at: null })
    })

    it('a member cannot smuggle a status into an insert: the column grant refuses', async () => {
      const { error } = await asMemberOne(shape).from('tickets').insert({
        org_id: orgAId,
        submitted_by: seed.memberOne,
        title: 'born resolved',
        description: 'should be refused at the column grant',
        status: 'resolved',
      })
      expect(error).not.toBeNull()
    })

    it('a member cannot submit a ticket as someone else', async () => {
      const { error } = await asMemberTwo(shape).from('tickets').insert({
        org_id: orgAId,
        submitted_by: seed.memberOne, // forged submitter
        title: 'impersonation attempt',
        description: 'the with check pins submitted_by to the session',
      })
      expect(error).not.toBeNull()
    })

    it("member two cannot comment on member one's ticket (cannot see it)", async () => {
      const { error } = await asMemberTwo(shape).from('ticket_comments').insert({
        org_id: orgAId,
        ticket_id: ticketOneId,
        author: seed.memberTwo,
        body: 'should never land',
      })
      expect(error).not.toBeNull()

      const { data: comments } = await service
        .from('ticket_comments')
        .select('author')
        .eq('ticket_id', ticketOneId)
      expect(comments).toEqual([{ author: seed.memberOne }])
    })

    it('no user session can write ticket_events, in any role, in any org', async () => {
      for (const client of [asMemberOne(shape), asAdmin(shape)]) {
        const insert = await client.from('ticket_events').insert({
          org_id: orgAId,
          ticket_id: ticketOneId,
          event_type: 'status_changed',
          actor: seed.admin,
          detail: 'forged history',
        })
        expect(insert.error).not.toBeNull()

        const update = await client
          .from('ticket_events')
          .update({ detail: 'edited history' })
          .eq('ticket_id', ticketOneId)
        expect(update.error).not.toBeNull()

        const del = await client
          .from('ticket_events')
          .delete()
          .eq('ticket_id', ticketOneId)
        expect(del.error).not.toBeNull()
      }

      expect(await trailOf(ticketOneId)).toEqual([
        expect.objectContaining({ event_type: 'created', detail: 'Ticket submitted.' }),
      ])
    })

    it('comments are immutable: the author cannot update or delete their own', async () => {
      const update = await asMemberOne(shape)
        .from('ticket_comments')
        .update({ body: 'edited' })
        .eq('id', commentOneId)
      expect(update.error).not.toBeNull()

      const del = await asMemberOne(shape)
        .from('ticket_comments')
        .delete()
        .eq('id', commentOneId)
      expect(del.error).not.toBeNull()

      const { data: intact } = await service
        .from('ticket_comments')
        .select('body')
        .eq('id', commentOneId)
        .single()
      expect(intact).toEqual({ body: 'It worked yesterday.' })
    })
  },
)

describe('the admin lifecycle, driven through RLS sessions', () => {
  // State transitions mutate the seed, so they run once each, walking the
  // lifecycle forward; each claim shape drives one transition, so both
  // shapes of the org claim are exercised on the update path too.
  it('the admin moves the ticket to in progress (legacy claim shape) and the trail records who', async () => {
    const { data, error } = await asAdmin('legacy')
      .from('tickets')
      .update({ status: 'in_progress' })
      .eq('id', ticketOneId)
      .select()
      .single()
    expect(error).toBeNull()
    expect(data).toMatchObject({ status: 'in_progress', resolved_at: null })

    const trail = await trailOf(ticketOneId)
    expect(trail).toHaveLength(2)
    expect(trail[1]).toEqual({
      event_type: 'status_changed',
      actor: seed.admin,
      detail: 'Status changed from open to in progress.',
    })
  })

  it('the admin resolves it (v2 claim shape); resolved_at is stamped by the trigger', async () => {
    const { data, error } = await asAdmin('v2')
      .from('tickets')
      .update({ status: 'resolved' })
      .eq('id', ticketOneId)
      .select()
      .single()
    expect(error).toBeNull()
    expect(data!.status).toBe('resolved')
    expect(data!.resolved_at).not.toBeNull()
    expect(data!.closed_at).toBeNull()

    const trail = await trailOf(ticketOneId)
    expect(trail[2]).toEqual({
      event_type: 'status_changed',
      actor: seed.admin,
      detail: 'Status changed from in progress to resolved.',
    })
  })

  it('the submitter can still comment while resolved', async () => {
    const { error } = await asMemberOne('legacy').from('ticket_comments').insert({
      org_id: orgAId,
      ticket_id: ticketOneId,
      author: seed.memberOne,
      body: 'Confirmed, it prints again. Thank you.',
    })
    expect(error).toBeNull()
  })

  it("the admin can comment on a member's ticket", async () => {
    const { error } = await asAdmin('v2').from('ticket_comments').insert({
      org_id: orgAId,
      ticket_id: ticketOneId,
      author: seed.admin,
      body: 'Glad it is sorted.',
    })
    expect(error).toBeNull()
  })

  it('an admin cannot write timestamps directly: the update grant is status only', async () => {
    const { error } = await asAdmin('legacy')
      .from('tickets')
      .update({ resolved_at: '2020-01-01T00:00:00Z' })
      .eq('id', ticketOneId)
    expect(error).not.toBeNull() // permission denied at the column grant
  })
})

describe('auto close: the sweep, the system note, and terminality', () => {
  it('the sweep closes tickets resolved more than 7 days ago and the trail says the system did it', async () => {
    // Backdate the resolution 8 days (service role, mirroring nothing: this
    // is test setup for "time passed"). Then run EXACTLY the update the
    // cron route runs.
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
    const backdate = await service
      .from('tickets')
      .update({ resolved_at: eightDaysAgo.toISOString() })
      .eq('id', ticketOneId)
    expect(backdate.error).toBeNull()

    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const { data: swept, error } = await service
      .from('tickets')
      .update({ status: 'closed' })
      .eq('status', 'resolved')
      .lt('resolved_at', cutoff.toISOString())
      .select('id')
    expect(error).toBeNull()
    expect((swept ?? []).map((t) => t.id)).toContain(ticketOneId)

    const { data: ticket } = await service
      .from('tickets')
      .select('status, resolved_at, closed_at')
      .eq('id', ticketOneId)
      .single()
    expect(ticket!.status).toBe('closed')
    expect(ticket!.closed_at).not.toBeNull()
    // The resolution timestamp survives the close; the record keeps both.
    expect(ticket!.resolved_at).not.toBeNull()

    const trail = await trailOf(ticketOneId)
    expect(trail[trail.length - 1]).toEqual({
      event_type: 'auto_closed',
      actor: null,
      detail: 'Closed automatically 7 days after it was resolved.',
    })
  })

  it('a fresh resolved ticket is untouched by the sweep', async () => {
    // ticketTwo goes to resolved now; the same sweep must not close it.
    const resolve = await asAdmin('legacy')
      .from('tickets')
      .update({ status: 'resolved' })
      .eq('id', ticketTwoId)
      .select()
      .single()
    expect(resolve.error).toBeNull()

    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const { error } = await service
      .from('tickets')
      .update({ status: 'closed' })
      .eq('status', 'resolved')
      .lt('resolved_at', cutoff.toISOString())
    expect(error).toBeNull()

    const { data: ticket } = await service
      .from('tickets')
      .select('status')
      .eq('id', ticketTwoId)
      .single()
    expect(ticket).toEqual({ status: 'resolved' })

    // Put it back so this test leaves no lifecycle surprises behind.
    const reopen = await asAdmin('legacy')
      .from('tickets')
      .update({ status: 'open' })
      .eq('id', ticketTwoId)
      .select()
      .single()
    expect(reopen.error).toBeNull()
    expect(reopen.data!.resolved_at).toBeNull() // reopening clears it
  })

  it('closed is terminal: not even an admin or the service role can move it', async () => {
    const asAdminTry = await asAdmin('v2')
      .from('tickets')
      .update({ status: 'open' })
      .eq('id', ticketOneId)
      .select()
    expect(asAdminTry.error).not.toBeNull() // the lifecycle trigger raises

    const asServiceTry = await service
      .from('tickets')
      .update({ status: 'open' })
      .eq('id', ticketOneId)
    expect(asServiceTry.error).not.toBeNull()

    const { data: intact } = await service
      .from('tickets')
      .select('status')
      .eq('id', ticketOneId)
      .single()
    expect(intact).toEqual({ status: 'closed' })
  })

  it('a closed ticket takes no new comments, not even from its submitter', async () => {
    const { error } = await asMemberOne('legacy').from('ticket_comments').insert({
      org_id: orgAId,
      ticket_id: ticketOneId,
      author: seed.memberOne,
      body: 'one more thing',
    })
    expect(error).not.toBeNull()
  })
})

describe('a session with no active organization', () => {
  it('sees zero rows in all three ticket tables, without error', async () => {
    const orgless = createMemberClient(orglessToken(seed.memberOne))

    for (const table of ['tickets', 'ticket_comments', 'ticket_events'] as const) {
      const { data, error } = await orgless.from(table).select()
      expect(error, `${table} select should not error`).toBeNull()
      expect(data, `${table} must be empty for an org-less session`).toEqual([])
    }
  })

  it('cannot write tickets or comments', async () => {
    const orgless = createMemberClient(orglessToken(seed.memberOne))

    const ticket = await orgless.from('tickets').insert({
      org_id: orgAId,
      submitted_by: seed.memberOne,
      title: 'orgless',
      description: 'must be refused',
    })
    expect(ticket.error).not.toBeNull()

    const comment = await orgless.from('ticket_comments').insert({
      org_id: orgAId,
      ticket_id: ticketTwoId,
      author: seed.memberOne,
      body: 'must be refused',
    })
    expect(comment.error).not.toBeNull()
  })
})
