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

// Isolation proof for the knowledge base (BRD F14, migration 014): THE
// VISIBILITY CONTRACT. Extends the suite per CLAUDE.md rules 2 and 8 (never
// skip, weaken, or delete). What is under test, all enforced at the
// database, none of it in app code:
//   - AUDIENCE: an untagged member sees empty audience articles only; a
//     tagged member sees empty audience plus overlapping ones; nobody sees
//     drafts; admins see everything in their org including drafts.
//   - NO TRACE: articles outside a member's audience return zero rows, not
//     errors, not counts. Invisible is indistinguishable from nonexistent.
//   - CROSS ORG: org A sees nothing of org B's articles or member tags, and
//     a tag spelled identically in both orgs grants nothing across.
//   - THE TAGS WRITE PATH: members cannot update tags, their own included
//     (refused loudly, 42501); the tags grant reaches tags alone, so role
//     and identity stay untouchable for every authenticated session; org A
//     admins cannot retag org B members.
//   - AUDIT FANOUT: every article action and a tag change produce exactly
//     one correctly mapped audit row, and no audit row ever carries body
//     content.
//   - THE WEBHOOK STILL WORKS: the service role paths clerk-sync uses
//     (membership upsert, role update, delete) are untouched by the posture
//     change.

const runId = randomUUID()
const seed = {
  orgA: { clerk_org_id: `org_art_a_${runId}`, name: 'Article Test Org A' },
  orgB: { clerk_org_id: `org_art_b_${runId}`, name: 'Article Test Org B' },
  adminA: `user_art_admin_a_${runId}`,
  taggedA: `user_art_tagged_a_${runId}`,
  untaggedA: `user_art_untagged_a_${runId}`,
  adminB: `user_art_admin_b_${runId}`,
  memberB: `user_art_member_b_${runId}`,
}

const BODY_SECRET = `body-content-${runId} with instructions nobody should see in the log`

let service: TestClient
let orgAId: string
let orgBId: string
let seeded = false

// Filled in beforeAll as adminA creates the fixture articles.
let everyoneArticleId: string
let onsiteArticleId: string
let financeArticleId: string
let draftArticleId: string

const asUser = (
  clerkUserId: string,
  clerkOrgId: string,
  shape: ClaimShape,
  claimRole?: 'member' | 'admin',
) => createMemberClient(memberToken({ clerkUserId, clerkOrgId, shape, claimRole }))

const asAdminA = () => asUser(seed.adminA, seed.orgA.clerk_org_id, 'legacy')

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

  // tags is stated on every row because PostgREST bulk inserts union the
  // keys across rows and send null for the missing ones, which the not null
  // constraint refuses; single row inserts (the webhook shape) omit the key
  // and get the default.
  const { error: memberErr } = await service.from('org_members').insert([
    { org_id: orgAId, clerk_user_id: seed.adminA, role: 'admin', tags: [] },
    { org_id: orgAId, clerk_user_id: seed.taggedA, role: 'member', tags: ['onsite'] },
    { org_id: orgAId, clerk_user_id: seed.untaggedA, role: 'member', tags: [] },
    { org_id: orgBId, clerk_user_id: seed.adminB, role: 'admin', tags: [] },
    // The same tag spelling as org A's tagged member, to prove tags never
    // cross the org boundary.
    { org_id: orgBId, clerk_user_id: seed.memberB, role: 'member', tags: ['onsite'] },
  ])
  if (memberErr) throw new Error(`Seeding org_members failed: ${memberErr.message}`)

  // Articles created through ADMIN A's OWN RLS session, proving the admin
  // write policy as part of seeding. The token claim stays the default
  // member, proving org_members.role, not the claim, is the authority.
  const create = async (
    title: string,
    audience_tags: string[],
  ): Promise<string> => {
    const { data, error } = await asAdminA()
      .from('articles')
      .insert({
        org_id: orgAId,
        title,
        body: BODY_SECRET,
        category: 'Guides',
        audience_tags,
        created_by: seed.adminA,
      })
      .select()
      .single()
    if (error) throw new Error(`Seeding article failed (admin policy?): ${error.message}`)
    return data.id
  }

  everyoneArticleId = await create('For everyone', [])
  onsiteArticleId = await create('For onsite staff', ['onsite'])
  financeArticleId = await create('For finance staff', ['finance'])
  draftArticleId = await create('Unfinished draft', [])

  // Publish all but the draft, as the admin, through the status column path.
  for (const id of [everyoneArticleId, onsiteArticleId, financeArticleId]) {
    const { error } = await asAdminA()
      .from('articles')
      .update({ status: 'published' })
      .eq('id', id)
    if (error) throw new Error(`Publishing fixture failed: ${error.message}`)
  }

  seeded = true
}, 60_000)

afterAll(async () => {
  if (!seeded) return
  await service
    .from('organizations')
    .delete()
    .in('clerk_org_id', [seed.orgA.clerk_org_id, seed.orgB.clerk_org_id])
})

describe.each(CLAIM_SHAPES)('the audience rule (%s claim shape)', (shape) => {
  it('an untagged member sees empty audience articles only', async () => {
    const { data, error } = await asUser(seed.untaggedA, seed.orgA.clerk_org_id, shape)
      .from('articles')
      .select('title')
    expect(error).toBeNull()
    expect(data!.map((a) => a.title)).toEqual(['For everyone'])
  })

  it('a tagged member sees empty audience plus overlapping, and nothing else', async () => {
    const { data, error } = await asUser(seed.taggedA, seed.orgA.clerk_org_id, shape)
      .from('articles')
      .select('title')
    expect(error).toBeNull()
    expect(data!.map((a) => a.title).sort()).toEqual([
      'For everyone',
      'For onsite staff',
    ])
  })

  it('no member sees the draft, tags or not; an invisible article 404s like nothing', async () => {
    for (const user of [seed.taggedA, seed.untaggedA]) {
      const draft = await asUser(user, seed.orgA.clerk_org_id, shape)
        .from('articles')
        .select()
        .eq('id', draftArticleId)
        .maybeSingle()
      expect(draft.error).toBeNull()
      expect(draft.data).toBeNull()
    }
    // Out of audience by id: same nothing, no error, no trace.
    const outside = await asUser(seed.untaggedA, seed.orgA.clerk_org_id, shape)
      .from('articles')
      .select()
      .eq('id', onsiteArticleId)
      .maybeSingle()
    expect(outside.error).toBeNull()
    expect(outside.data).toBeNull()
  })

  it('an admin sees every article in the org, drafts and all audiences included', async () => {
    const { data, error } = await asUser(seed.adminA, seed.orgA.clerk_org_id, shape)
      .from('articles')
      .select('title')
    expect(error).toBeNull()
    expect(data).toHaveLength(4)
  })

  it('a member token claiming admin still gets the member view: the column is the authority', async () => {
    const { data } = await asUser(seed.untaggedA, seed.orgA.clerk_org_id, shape, 'admin')
      .from('articles')
      .select('title')
    expect(data!.map((a) => a.title)).toEqual(['For everyone'])
  })
})

describe.each(CLAIM_SHAPES)('cross org isolation (%s claim shape)', (shape) => {
  it('org B sees nothing of org A articles, matching tag spelling included', async () => {
    // memberB carries the tag onsite, exactly like org A's tagged member.
    // If tags granted across orgs this would leak the onsite article.
    const members = await asUser(seed.memberB, seed.orgB.clerk_org_id, shape)
      .from('articles')
      .select()
    expect(members.error).toBeNull()
    expect(members.data).toEqual([])

    const admins = await asUser(seed.adminB, seed.orgB.clerk_org_id, shape)
      .from('articles')
      .select()
    expect(admins.error).toBeNull()
    expect(admins.data).toEqual([])
  })

  it('org B sees nothing of org A member tags', async () => {
    const { data, error } = await asUser(seed.adminB, seed.orgB.clerk_org_id, shape)
      .from('org_members')
      .select('clerk_user_id, tags')
    expect(error).toBeNull()
    expect(data!.every((m) => m.clerk_user_id.includes('_b_'))).toBe(true)
  })

  it('org B admin cannot write an article into org A', async () => {
    const { error } = await asUser(seed.adminB, seed.orgB.clerk_org_id, shape)
      .from('articles')
      .insert({
        org_id: orgAId,
        title: 'Cross org plant',
        body: 'x',
        created_by: seed.adminB,
      })
    expect(error).not.toBeNull()
  })
})

describe('the tags write path (migration 014 posture)', () => {
  it.each(CLAIM_SHAPES)(
    'a member cannot update tags, their own included: refused loudly (%s)',
    async (shape) => {
      const own = await asUser(seed.taggedA, seed.orgA.clerk_org_id, shape)
        .from('org_members')
        .update({ tags: ['onsite', 'finance', 'everything'] })
        .eq('org_id', orgAId)
        .eq('clerk_user_id', seed.taggedA)
      expect(own.error).not.toBeNull()
      expect(own.error!.code).toBe('42501')

      const someone = await asUser(seed.taggedA, seed.orgA.clerk_org_id, shape, 'admin')
        .from('org_members')
        .update({ tags: ['finance'] })
        .eq('org_id', orgAId)
        .eq('clerk_user_id', seed.untaggedA)
      expect(someone.error).not.toBeNull()
      expect(someone.error!.code).toBe('42501')

      // Untouched, verified via the service role.
      const { data } = await service
        .from('org_members')
        .select('tags')
        .eq('org_id', orgAId)
        .eq('clerk_user_id', seed.taggedA)
        .single()
      expect(data!.tags).toEqual(['onsite'])
    },
  )

  it('role, org_id, and identity are refused at the grant, admins included', async () => {
    for (const patch of [
      { role: 'admin' },
      { org_id: orgBId },
      { clerk_user_id: 'user_forged' },
    ]) {
      const { error } = await asAdminA()
        .from('org_members')
        .update(patch)
        .eq('org_id', orgAId)
        .eq('clerk_user_id', seed.untaggedA)
      expect(error).not.toBeNull()
      expect(error!.code).toBe('42501')
    }
  })

  it('membership insert is refused at the grant since 014: the webhook is the only member writer', async () => {
    const { error } = await asAdminA()
      .from('org_members')
      .insert({ org_id: orgAId, clerk_user_id: 'user_smuggled', role: 'member' })
    expect(error).not.toBeNull()
    expect(error!.code).toBe('42501')
  })

  it('an org A admin cannot touch org B member tags: zero rows, B unchanged', async () => {
    await asAdminA()
      .from('org_members')
      .update({ tags: ['hijacked'] })
      .eq('org_id', orgBId)
      .eq('clerk_user_id', seed.memberB)
    const { data } = await service
      .from('org_members')
      .select('tags')
      .eq('org_id', orgBId)
      .eq('clerk_user_id', seed.memberB)
      .single()
    expect(data!.tags).toEqual(['onsite'])
  })

  it('an admin CAN retag their org member, and visibility follows immediately', async () => {
    const { error } = await asAdminA()
      .from('org_members')
      .update({ tags: ['finance'] })
      .eq('org_id', orgAId)
      .eq('clerk_user_id', seed.untaggedA)
    expect(error).toBeNull()

    const { data } = await asUser(seed.untaggedA, seed.orgA.clerk_org_id, 'legacy')
      .from('articles')
      .select('title')
    expect(data!.map((a) => a.title).sort()).toEqual([
      'For everyone',
      'For finance staff',
    ])

    // Back to untagged for any later assertions, via the same admin path.
    await asAdminA()
      .from('org_members')
      .update({ tags: [] })
      .eq('org_id', orgAId)
      .eq('clerk_user_id', seed.untaggedA)
  })
})

describe('audit fanout: one correctly mapped row per action, no body content', () => {
  it('the article lifecycle so far produced exactly the expected rows', async () => {
    // Seeding created four articles and published three of them, all as
    // adminA. The tag flip above recorded two member_tags_changed rows.
    const { data, error } = await service
      .from('audit_log')
      .select()
      .eq('org_id', orgAId)
      .order('occurred_at', { ascending: true })
    expect(error).toBeNull()

    const created = data!.filter((r) => r.action === 'article_created')
    expect(created).toHaveLength(4)
    expect(created.every((r) => r.actor === seed.adminA)).toBe(true)

    const published = data!.filter((r) => r.action === 'article_published')
    expect(published).toHaveLength(3)

    const tagChanges = data!.filter((r) => r.action === 'member_tags_changed')
    expect(tagChanges).toHaveLength(2)
    expect(tagChanges[0].detail).toEqual({
      target_user_id: seed.untaggedA,
      tags: ['finance'],
    })
    expect(tagChanges[1].detail).toEqual({
      target_user_id: seed.untaggedA,
      tags: [],
    })
  })

  it('an edit records one article_updated row naming the changed fields, not the content', async () => {
    const { error } = await asAdminA()
      .from('articles')
      .update({ title: 'For every member', category: 'Basics' })
      .eq('id', everyoneArticleId)
    expect(error).toBeNull()

    const { data } = await service
      .from('audit_log')
      .select()
      .eq('org_id', orgAId)
      .eq('action', 'article_updated')
    expect(data).toHaveLength(1)
    expect(data![0].detail).toEqual({
      title: 'For every member',
      changed: ['title', 'category'],
    })
  })

  it('publish with edits in one save maps to article_published alone, exactly one row', async () => {
    const { error } = await asAdminA()
      .from('articles')
      .update({ status: 'published', title: 'Finished guide' })
      .eq('id', draftArticleId)
    expect(error).toBeNull()

    const { data } = await service
      .from('audit_log')
      .select('action')
      .eq('org_id', orgAId)
      .in('action', ['article_published', 'article_updated'])
    // 3 seed publishes + this one; still exactly 1 update from the edit test.
    expect(data!.filter((r) => r.action === 'article_published')).toHaveLength(4)
    expect(data!.filter((r) => r.action === 'article_updated')).toHaveLength(1)
  })

  it('unpublish and delete record their own actions', async () => {
    await asAdminA()
      .from('articles')
      .update({ status: 'draft' })
      .eq('id', draftArticleId)
    await asAdminA().from('articles').delete().eq('id', financeArticleId)

    const { data } = await service
      .from('audit_log')
      .select()
      .eq('org_id', orgAId)
      .in('action', ['article_unpublished', 'article_deleted'])
    expect(data!.map((r) => r.action).sort()).toEqual([
      'article_deleted',
      'article_unpublished',
    ])
    const deleted = data!.find((r) => r.action === 'article_deleted')!
    expect(deleted.detail).toEqual({ title: 'For finance staff' })
  })

  it('no audit row anywhere carries article body content', async () => {
    const { data } = await service.from('audit_log').select().eq('org_id', orgAId)
    expect(data!.length).toBeGreaterThan(0)
    for (const row of data!) {
      expect(JSON.stringify(row.detail)).not.toContain(BODY_SECRET.slice(0, 20))
    }
  })
})

describe('the webhook service role paths still function (clerk-sync spot check)', () => {
  it('membership upsert, role update, and delete all work as before 014', async () => {
    const ghost = `user_art_ghost_${runId}`

    // The clerk-sync upsert shape.
    const upsert = await service.from('org_members').upsert(
      { org_id: orgAId, clerk_user_id: ghost, role: 'member' },
      { onConflict: 'org_id,clerk_user_id' },
    )
    expect(upsert.error).toBeNull()

    // A role change (organizationMembership.updated): the audit trigger
    // records it with actor NULL, and the write itself is unhindered.
    const roleChange = await service
      .from('org_members')
      .update({ role: 'technician' })
      .eq('org_id', orgAId)
      .eq('clerk_user_id', ghost)
    expect(roleChange.error).toBeNull()

    // organizationMembership.deleted.
    const del = await service
      .from('org_members')
      .delete()
      .eq('org_id', orgAId)
      .eq('clerk_user_id', ghost)
    expect(del.error).toBeNull()

    const { data } = await service
      .from('audit_log')
      .select()
      .eq('org_id', orgAId)
      .eq('action', 'member_role_changed')
    expect(data).toHaveLength(1)
    expect(data![0].actor).toBeNull()
    expect(data![0].detail).toMatchObject({ target_user_id: ghost })
  })
})
