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

// Isolation proof for AI support chat and the chat to ticket bridge (Phase 1
// Task 5), extending the suite per CLAUDE.md rules 2 and 8. Rules under test,
// all enforced at the database:
//   - VISIBILITY (addendum ruling): a member reads only their OWN
//     conversations; an org admin reads them ALL; org B reads none. Messages
//     ride conversation visibility.
//   - MESSAGES ARE SYSTEM WRITTEN: a member cannot insert chat_messages
//     directly (like monitor_checks); the server is the only writer.
//   - CREATION IS PINNED: a member creates a conversation only as themselves.
//   - THE NEW BRIDGE BOUNDARY: a ticket may carry a conversation_id only when
//     that conversation is one the caller can see in the same org. Org B cannot
//     link A's conversation; a member cannot link a conversation they cannot
//     see. Proven non vacuous by seeding a linked ticket through a member's own
//     RLS session.
//   - THE LINK IS FIXED AT BIRTH: conversation_id is not in the update grant.
//
// Conversations are seeded through the real production write path (a member
// client under RLS), so seeding itself proves members create their own.

const runId = randomUUID()
const seed = {
  orgA: { clerk_org_id: `org_chat_a_${runId}`, name: 'Chat Test Org A' },
  orgB: { clerk_org_id: `org_chat_b_${runId}`, name: 'Chat Test Org B' },
  adminA: `user_chat_admin_a_${runId}`,
  memberOne: `user_chat_one_${runId}`,
  memberTwo: `user_chat_two_${runId}`,
  memberB: `user_chat_b_${runId}`,
}

let service: TestClient
let orgAId: string
let orgBId: string
let convoOneId: string
let convoTwoId: string
let convoBId: string
let linkedTicketId: string
let seeded = false

const asUser = (clerkUserId: string, clerkOrgId: string, shape: ClaimShape) =>
  createMemberClient(memberToken({ clerkUserId, clerkOrgId, shape }))

const asOne = (shape: ClaimShape) => asUser(seed.memberOne, seed.orgA.clerk_org_id, shape)
const asTwo = (shape: ClaimShape) => asUser(seed.memberTwo, seed.orgA.clerk_org_id, shape)
const asAdminA = (shape: ClaimShape) => asUser(seed.adminA, seed.orgA.clerk_org_id, shape)
const asMemberB = (shape: ClaimShape) => asUser(seed.memberB, seed.orgB.clerk_org_id, shape)

async function seedConversation(
  clerkUserId: string,
  clerkOrgId: string,
  orgUuid: string,
  title: string,
): Promise<string> {
  // Created through the member's OWN RLS session, proving members create their
  // own conversations.
  const { data: convo, error } = await createMemberClient(
    memberToken({ clerkUserId, clerkOrgId, shape: 'legacy' }),
  )
    .from('chat_conversations')
    .insert({ org_id: orgUuid, created_by: clerkUserId, title })
    .select('id')
    .single()
  if (error || !convo) throw new Error(`Seeding conversation failed: ${error?.message}`)

  // Messages are system written (service role), like monitor_checks.
  const { error: mErr } = await service.from('chat_messages').insert([
    { org_id: orgUuid, conversation_id: convo.id, role: 'user', content: `${title}: my question` },
    {
      org_id: orgUuid,
      conversation_id: convo.id,
      role: 'assistant',
      content: `${title}: my answer`,
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      input_tokens: 5,
      output_tokens: 7,
    },
  ])
  if (mErr) throw new Error(`Seeding messages failed: ${mErr.message}`)
  return convo.id
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
    { org_id: orgAId, clerk_user_id: seed.adminA, role: 'admin' },
    { org_id: orgAId, clerk_user_id: seed.memberOne, role: 'member' },
    { org_id: orgAId, clerk_user_id: seed.memberTwo, role: 'member' },
    { org_id: orgBId, clerk_user_id: seed.memberB, role: 'member' },
  ])
  if (memberErr) throw new Error(`Seeding org_members failed: ${memberErr.message}`)

  convoOneId = await seedConversation(seed.memberOne, seed.orgA.clerk_org_id, orgAId, 'One')
  convoTwoId = await seedConversation(seed.memberTwo, seed.orgA.clerk_org_id, orgAId, 'Two')
  convoBId = await seedConversation(seed.memberB, seed.orgB.clerk_org_id, orgBId, 'B')

  // Non vacuous link: member One links their OWN conversation to their own
  // ticket, through their own RLS session. If the with check gated this wrong,
  // seeding fails loudly.
  const { data: ticket, error: tErr } = await asOne('legacy')
    .from('tickets')
    .insert({
      org_id: orgAId,
      submitted_by: seed.memberOne,
      title: 'Escalated from chat',
      description: 'Please help.',
      conversation_id: convoOneId,
    })
    .select('id')
    .single()
  if (tErr || !ticket) {
    throw new Error(`Seeding linked ticket failed (with check?): ${tErr?.message}`)
  }
  linkedTicketId = ticket.id

  seeded = true
}, 60_000)

afterAll(async () => {
  if (!seeded) return
  await service
    .from('organizations')
    .delete()
    .in('clerk_org_id', [seed.orgA.clerk_org_id, seed.orgB.clerk_org_id])
})

describe.each(CLAIM_SHAPES)('conversation visibility (%s claim shape)', (shape) => {
  it('a member sees only their own conversation, not another member’s', async () => {
    const one = await asOne(shape).from('chat_conversations').select('id')
    expect(one.error).toBeNull()
    const ids = (one.data ?? []).map((c) => c.id)
    expect(ids).toContain(convoOneId)
    expect(ids).not.toContain(convoTwoId)

    const direct = await asOne(shape)
      .from('chat_conversations')
      .select('id')
      .eq('id', convoTwoId)
    expect(direct.data).toEqual([])
  })

  it('member Two cannot read member One’s conversation', async () => {
    const two = await asTwo(shape).from('chat_conversations').select('id').eq('id', convoOneId)
    expect(two.error).toBeNull()
    expect(two.data).toEqual([])
  })

  it('an org admin reads every conversation in the org (workplace records)', async () => {
    const all = await asAdminA(shape).from('chat_conversations').select('id')
    expect(all.error).toBeNull()
    const ids = (all.data ?? []).map((c) => c.id)
    expect(ids).toContain(convoOneId)
    expect(ids).toContain(convoTwoId)
    expect(ids).not.toContain(convoBId)
  })

  it('org B sees nothing of org A conversations', async () => {
    const b = await asMemberB(shape).from('chat_conversations').select('id')
    expect(b.error).toBeNull()
    const ids = (b.data ?? []).map((c) => c.id)
    expect(ids).not.toContain(convoOneId)
    expect(ids).not.toContain(convoTwoId)
    expect(ids).toEqual([convoBId])
  })
})

describe.each(CLAIM_SHAPES)('messages ride conversation visibility (%s)', (shape) => {
  it('member One reads their own messages but not member Two’s', async () => {
    const mine = await asOne(shape)
      .from('chat_messages')
      .select('id')
      .eq('conversation_id', convoOneId)
    expect(mine.error).toBeNull()
    expect((mine.data ?? []).length).toBe(2)

    const theirs = await asOne(shape)
      .from('chat_messages')
      .select('id')
      .eq('conversation_id', convoTwoId)
    expect(theirs.data).toEqual([])
  })

  it('an admin reads messages of any conversation in the org', async () => {
    const twoMsgs = await asAdminA(shape)
      .from('chat_messages')
      .select('id')
      .eq('conversation_id', convoTwoId)
    expect((twoMsgs.data ?? []).length).toBe(2)
  })

  it('a member cannot insert a message directly (system written)', async () => {
    const { error } = await asOne(shape).from('chat_messages').insert({
      org_id: orgAId,
      conversation_id: convoOneId,
      role: 'assistant',
      content: 'forged assistant message',
    })
    expect(error).not.toBeNull()
  })
})

describe.each(CLAIM_SHAPES)('conversation creation is pinned to the caller (%s)', (shape) => {
  it('a member cannot create a conversation as another user', async () => {
    const { error } = await asOne(shape).from('chat_conversations').insert({
      org_id: orgAId,
      created_by: seed.memberTwo, // not me
      title: 'impersonation',
    })
    expect(error).not.toBeNull()
  })

  it('only the creator updates status; another member and an admin match zero rows', async () => {
    await asTwo(shape)
      .from('chat_conversations')
      .update({ status: 'resolved' })
      .eq('id', convoOneId)
    await asAdminA(shape)
      .from('chat_conversations')
      .update({ status: 'resolved' })
      .eq('id', convoOneId)
    const { data } = await service
      .from('chat_conversations')
      .select('status')
      .eq('id', convoOneId)
      .single()
    expect(data!.status).toBe('open')
  })
})

describe('control: the seed proves the link and the trail', () => {
  it('member One created the linked ticket pointing at their conversation', async () => {
    const { data } = await service
      .from('tickets')
      .select('submitted_by, conversation_id, incident_id')
      .eq('id', linkedTicketId)
      .single()
    expect(data).toEqual({
      submitted_by: seed.memberOne,
      conversation_id: convoOneId,
      incident_id: null,
    })
  })

  it('the trail records created_from_chat with the conversation id in detail', async () => {
    const { data } = await service
      .from('ticket_events')
      .select('event_type, actor, detail')
      .eq('ticket_id', linkedTicketId)
    expect(data).toHaveLength(1)
    expect(data![0].event_type).toBe('created_from_chat')
    expect(data![0].actor).toBe(seed.memberOne)
    expect(data![0].detail).toContain(convoOneId)
  })
})

describe.each(CLAIM_SHAPES)('the new bridge boundary (%s claim shape)', (shape) => {
  it('org B cannot create a ticket linked to A’s conversation; A is unchanged', async () => {
    const { error } = await asMemberB(shape).from('tickets').insert({
      org_id: orgBId,
      submitted_by: seed.memberB,
      title: 'stealing a chat',
      description: 'links to another org conversation, must be refused',
      conversation_id: convoOneId,
    })
    expect(error).not.toBeNull()

    const { data } = await service
      .from('tickets')
      .select('id')
      .eq('conversation_id', convoOneId)
    expect(data).toEqual([{ id: linkedTicketId }])
  })

  it('a member cannot link a conversation they cannot see (another member’s)', async () => {
    const { error } = await asTwo(shape).from('tickets').insert({
      org_id: orgAId,
      submitted_by: seed.memberTwo,
      title: 'reaching into another chat',
      description: 'links to member One conversation, must be refused',
      conversation_id: convoOneId,
    })
    expect(error).not.toBeNull()

    const { data } = await service
      .from('tickets')
      .select('id')
      .eq('conversation_id', convoOneId)
    expect(data).toEqual([{ id: linkedTicketId }])
  })

  it('an ordinary unlinked ticket still creates fine', async () => {
    const { data, error } = await asTwo(shape)
      .from('tickets')
      .insert({
        org_id: orgAId,
        submitted_by: seed.memberTwo,
        title: 'ordinary request',
        description: 'no conversation_id',
      })
      .select('conversation_id, incident_id, status')
      .single()
    expect(error).toBeNull()
    expect(data).toEqual({ conversation_id: null, incident_id: null, status: 'open' })
  })
})

describe('the link is fixed at birth', () => {
  it('conversation_id is not in the update grant: not even an admin can rewrite it', async () => {
    const { error } = await asAdminA('v2')
      .from('tickets')
      .update({ conversation_id: convoTwoId })
      .eq('id', linkedTicketId)
    expect(error).not.toBeNull()
    const { data } = await service
      .from('tickets')
      .select('conversation_id')
      .eq('id', linkedTicketId)
      .single()
    expect(data).toEqual({ conversation_id: convoOneId })
  })
})

describe('a session with no active organization', () => {
  it('cannot create a linked ticket', async () => {
    const orgless = createMemberClient(orglessToken(seed.memberOne))
    const { error } = await orgless.from('tickets').insert({
      org_id: orgAId,
      submitted_by: seed.memberOne,
      title: 'orgless link',
      description: 'must be refused',
      conversation_id: convoOneId,
    })
    expect(error).not.toBeNull()
  })
})
