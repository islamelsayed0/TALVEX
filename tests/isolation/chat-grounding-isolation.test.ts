import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { retrieveGroundingArticles } from '@/lib/chat/retrieval'
import {
  CLAIM_SHAPES,
  createMemberClient,
  createServiceClient,
  memberToken,
  preflight,
  type ClaimShape,
  type TestClient,
} from './local-stack'

// Isolation proof for chat grounding (the F14 follow up). Extends the suite
// per CLAUDE.md rules 2 and 8 (never skip, weaken, or delete). The one rule
// of the feature is proven here with the REAL retrieval function running on
// member scoped clients against the real policies:
//   - AUDIENCE: the same question retrieves the targeted article for the
//     member holding the tag and nothing for the member without it. The
//     database decides; retrieval has no filtering of its own to get wrong.
//   - DRAFTS: never retrieved, by anyone, including the admin whose own RLS
//     can read them: the explicit published filter exists exactly for that.
//   - CROSS ORG: org A retrieval never returns org B articles, tag spelling
//     match or not.
//   - THE CITATION COLUMN: authenticated cannot write grounded_article_ids
//     (or anything else on chat_messages); the service role writes it, and
//     the shape constraint refuses it on user turns.

const runId = randomUUID()
const seed = {
  orgA: { clerk_org_id: `org_ground_a_${runId}`, name: 'Grounding Org A' },
  orgB: { clerk_org_id: `org_ground_b_${runId}`, name: 'Grounding Org B' },
  adminA: `user_ground_admin_a_${runId}`,
  taggedA: `user_ground_tagged_a_${runId}`,
  untaggedA: `user_ground_untagged_a_${runId}`,
  memberB: `user_ground_member_b_${runId}`,
}

let service: TestClient
let orgAId: string
let orgBId: string
let seeded = false
let printerArticleId: string

const PRINTER_TERMS = ['printer', 'office']

const asUser = (
  clerkUserId: string,
  clerkOrgId: string,
  shape: ClaimShape,
  claimRole?: 'member' | 'admin',
) => createMemberClient(memberToken({ clerkUserId, clerkOrgId, shape, claimRole }))

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
    { org_id: orgAId, clerk_user_id: seed.adminA, role: 'admin', tags: [] },
    { org_id: orgAId, clerk_user_id: seed.taggedA, role: 'member', tags: ['printers'] },
    { org_id: orgAId, clerk_user_id: seed.untaggedA, role: 'member', tags: [] },
    { org_id: orgBId, clerk_user_id: seed.memberB, role: 'member', tags: ['printers'] },
  ])
  if (memberErr) throw new Error(`Seeding org_members failed: ${memberErr.message}`)

  const mkArticle = (
    org_id: string,
    title: string,
    audience_tags: string[],
    status: 'draft' | 'published',
    category: string,
    body = 'How to fix the office printer: turn it off, wait, turn it on.',
  ) => ({
    org_id,
    title,
    body,
    category,
    audience_tags,
    status,
    created_by: seed.adminA,
    published_at: status === 'published' ? new Date(0).toISOString() : null,
  })

  const { data: articles, error: artErr } = await service
    .from('articles')
    .insert([
      mkArticle(orgAId, 'Office printer setup', ['printers'], 'published', 'Printers'),
      // Deliberately nothing printer shaped in title, category, tags, or
      // body: the untagged member's printer question must retrieve nothing.
      mkArticle(orgAId, 'Password rules', [], 'published', 'Accounts', 'Choose a long passphrase.'),
      mkArticle(orgAId, 'Printer draft, unfinished', [], 'draft', 'Printers'),
      mkArticle(orgBId, 'Office printer setup for B', ['printers'], 'published', 'Printers'),
    ])
    .select()
  if (artErr) throw new Error(`Seeding articles failed: ${artErr.message}`)
  printerArticleId = articles.find((a) => a.title === 'Office printer setup')!.id

  seeded = true
}, 60_000)

afterAll(async () => {
  if (!seeded) return
  await service
    .from('organizations')
    .delete()
    .in('clerk_org_id', [seed.orgA.clerk_org_id, seed.orgB.clerk_org_id])
})

describe.each(CLAIM_SHAPES)('retrieval follows the audience (%s claim shape)', (shape) => {
  it('the tagged member retrieves the targeted article for the printer question', async () => {
    const client = asUser(seed.taggedA, seed.orgA.clerk_org_id, shape)
    const results = await retrieveGroundingArticles(client, PRINTER_TERMS)
    expect(results.map((a) => a.title)).toContain('Office printer setup')
    expect(results.every((a) => a.org_id === orgAId)).toBe(true)
  })

  it('the untagged member retrieves nothing for the same question', async () => {
    const client = asUser(seed.untaggedA, seed.orgA.clerk_org_id, shape)
    const results = await retrieveGroundingArticles(client, PRINTER_TERMS)
    expect(results).toEqual([])
  })

  it('the untagged member still retrieves articles for everyone', async () => {
    const client = asUser(seed.untaggedA, seed.orgA.clerk_org_id, shape)
    const results = await retrieveGroundingArticles(client, ['password', 'passphrase'])
    expect(results.map((a) => a.title)).toEqual(['Password rules'])
  })
})

describe('drafts are never retrieved', () => {
  it('not by members, and not by the admin whose RLS can read them', async () => {
    // The draft matches the printer terms by title and body; only the
    // explicit published filter keeps it out of the admin's results.
    for (const user of [seed.taggedA, seed.untaggedA, seed.adminA]) {
      const client = asUser(user, seed.orgA.clerk_org_id, 'legacy')
      const results = await retrieveGroundingArticles(client, PRINTER_TERMS)
      expect(results.some((a) => a.title.includes('draft'))).toBe(false)
    }
  })
})

describe.each(CLAIM_SHAPES)('cross org isolation (%s claim shape)', (shape) => {
  it('org B retrieval returns only org B articles despite the matching tag', async () => {
    const client = asUser(seed.memberB, seed.orgB.clerk_org_id, shape)
    const results = await retrieveGroundingArticles(client, PRINTER_TERMS)
    expect(results.map((a) => a.title)).toEqual(['Office printer setup for B'])
    expect(results.every((a) => a.org_id === orgBId)).toBe(true)
  })
})

describe('the citation column is service role written only', () => {
  let conversationId: string
  let assistantMessageId: string

  beforeAll(async () => {
    // The conversation is created by the member (their own insert grant);
    // messages are service role written, exactly like the engine does it.
    const { data: convo, error: cErr } = await asUser(
      seed.taggedA,
      seed.orgA.clerk_org_id,
      'legacy',
    )
      .from('chat_conversations')
      .insert({ org_id: orgAId, created_by: seed.taggedA, title: 'Printer help' })
      .select('id')
      .single()
    if (cErr) throw new Error(`Seeding conversation failed: ${cErr.message}`)
    conversationId = convo.id

    const { data: msg, error: mErr } = await service
      .from('chat_messages')
      .insert({
        org_id: orgAId,
        conversation_id: conversationId,
        role: 'assistant',
        content: 'Try turning the printer off and on.',
        grounded_article_ids: [printerArticleId],
      })
      .select('id')
      .single()
    if (mErr) throw new Error(`Seeding grounded message failed: ${mErr.message}`)
    assistantMessageId = msg.id
  })

  it('the service role write landed and the member can read the ids back', async () => {
    const { data, error } = await asUser(seed.taggedA, seed.orgA.clerk_org_id, 'v2')
      .from('chat_messages')
      .select('grounded_article_ids')
      .eq('id', assistantMessageId)
      .single()
    expect(error).toBeNull()
    expect(data!.grounded_article_ids).toEqual([printerArticleId])
  })

  it.each(CLAIM_SHAPES)(
    'authenticated cannot write the column: update and insert refused at the grant (%s)',
    async (shape) => {
      const client = asUser(seed.taggedA, seed.orgA.clerk_org_id, shape)
      const upd = await client
        .from('chat_messages')
        .update({ grounded_article_ids: ['forged'] })
        .eq('id', assistantMessageId)
      expect(upd.error).not.toBeNull()
      expect(upd.error!.code).toBe('42501')

      const ins = await client.from('chat_messages').insert({
        org_id: orgAId,
        conversation_id: conversationId,
        role: 'assistant',
        content: 'forged grounded reply',
        grounded_article_ids: [printerArticleId],
      })
      expect(ins.error).not.toBeNull()
      expect(ins.error!.code).toBe('42501')
    },
  )

  it('the shape constraint refuses grounding on a user turn even for the service role', async () => {
    const { error } = await service.from('chat_messages').insert({
      org_id: orgAId,
      conversation_id: conversationId,
      role: 'user',
      content: 'my printer is broken',
      grounded_article_ids: [printerArticleId],
    })
    expect(error).not.toBeNull()
    expect(error!.code).toBe('23514')
  })
})
