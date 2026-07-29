-- Migration 014: the knowledge base with audience targeting (BRD F14).
--
-- Org admins write help articles and control WHO in the org can read each
-- one. Targeting is tags on both sides: admins assign tags to members
-- (org_members.tags below), articles carry audience_tags, and a member sees
-- a published article when its audience is empty (everyone) or overlaps
-- their tags. There is no deny mechanism; tags only grant.
--
-- THE VISIBILITY CONTRACT, stated once and enforced here: visibility is
-- RLS, never app code. The member select policy below is the entire rule.
-- Screens, and the AI chat grounding that follows this feature, read
-- through the caller's scoped client and receive only what that caller may
-- see; retrieval as the asking user is therefore physically unable to
-- surface an article the user could not open.
--
-- Nothing here is public. anon holds no verb on any of it.

-- ---------------------------------------------------------------------------
-- Member tags on org_members, and the write posture change that carries
-- them. org_members has been webhook written in practice since migration
-- 001: the owner and admin correction policies 001 created (insert, update
-- role) were never used by any application path, and the Clerk webhook on
-- the service role is the only writer the product has ever had. Tags are
-- the FIRST authenticated write onto this table, so the vestigial 001 write
-- path goes away in the same migration that adds the real one, leaving the
-- posture the narrow one the organizations precedent set in migrations 011
-- and 012: one admin gated update policy, one column scoped grant, and the
-- row's identity (org_id, clerk_user_id) plus role untouchable by
-- authenticated at the verb layer.

alter table public.org_members
  add column tags text[] not null default '{}';

-- Bounded in count at the database; per tag length and normalization
-- (lowercase, trimmed) are enforced server side in src/lib/db/, which is
-- the only authenticated writer.
alter table public.org_members
  add constraint org_members_tags_bounded check (
    coalesce(array_length(tags, 1), 0) <= 20
  );

comment on column public.org_members.tags is
  'Audience tags admins assign to a member. An article whose audience_tags overlaps these (or is empty) is readable by this member. Admin written only, through the tags column grant; the webhook never touches this column.';

-- The vestigial 001 correction path, removed: never used by the app, and it
-- would let the new admin gated policy below reach the role column through
-- the 009 update grant (policies name rows, grants name columns; only
-- removing the grant keeps role webhook only).
drop policy "org admins insert membership" on public.org_members;
drop policy "org admins update membership" on public.org_members;
revoke insert on table public.org_members from authenticated;
revoke update on table public.org_members from authenticated;

-- The one authenticated write onto org_members: admins of the org retag
-- members. The role authority is org_members.role through is_org_admin
-- (migration 005), never the token claim. Shape note: using admits the
-- org's rows and the admin test lives in with check, so a non admin's
-- attempt is refused loudly (42501, row level security violation) instead
-- of matching zero rows and reading as success. Cross org stays silent:
-- another org's rows never enter the update set at all.
create policy "org admins update member tags"
on public.org_members
for update
to authenticated
using (
  org_id in (
    select id from public.organizations
    where clerk_org_id = (select public.clerk_active_org_id())
  )
)
with check (
  org_id in (
    select id from public.organizations
    where clerk_org_id = (select public.clerk_active_org_id())
  )
  and public.is_org_admin(org_id)
);

-- The grant reaches tags and nothing else: role, org_id, and clerk_user_id
-- stay unreachable for authenticated even through the policy above.
grant update (tags) on table public.org_members to authenticated;

-- ---------------------------------------------------------------------------
-- The caller's own tags, for the article policy. SECURITY DEFINER per the
-- is_org_admin shape ruling so the policy reads them without depending on
-- the org_members select policy from inside another table's policy
-- evaluation. It returns the session user's tags in their active org and
-- nothing else; no argument, so there is nothing to point at another user.
-- Pinned empty search_path; execute revoked from public and anon.

create function public.member_audience_tags()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select m.tags
      from public.org_members m
      join public.organizations o on o.id = m.org_id
      where o.clerk_org_id = public.clerk_active_org_id()
        and m.clerk_user_id = public.clerk_user_id()
    ),
    '{}'::text[]
  )
$$;

comment on function public.member_audience_tags() is
  'The session user''s own tags in their active org, for the articles member select policy. SECURITY DEFINER, no arguments: it can only ever answer for the caller.';

revoke execute on function public.member_audience_tags() from public, anon;
grant execute on function public.member_audience_tags() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- articles. Shape per the Help_me knowledge module (title, body, category,
-- publish state) plus the new audience_tags. Helpful votes and view counts
-- are deliberately not ported. Category is organization, audience is
-- access; they never mix.

create table public.articles (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations (id) on delete cascade,
  title          text not null check (btrim(title) <> '' and char_length(title) <= 200),
  -- Markdown, rendered sanitized server side. Never raw HTML passthrough;
  -- the renderer emits React elements, so the database stores source text
  -- and the browser never receives it as markup.
  body           text not null check (btrim(body) <> '' and char_length(body) <= 50000),
  -- Plain text grouping label, a select populated from existing values in
  -- the admin UI. NULL means uncategorized.
  category       text check (category is null or (btrim(category) <> '' and char_length(category) <= 60)),
  -- Empty means every member. Tags only grant; there is no deny.
  audience_tags  text[] not null default '{}',
  status         text not null default 'draft' check (status in ('draft', 'published')),
  created_by     text not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  published_at   timestamptz,
  constraint articles_audience_tags_bounded check (
    coalesce(array_length(audience_tags, 1), 0) <= 20
  )
);

comment on table public.articles is
  'Org help articles (BRD F14). Admin written; members read published rows whose audience_tags are empty or overlap their org_members.tags. The member select policy IS the visibility contract; chat grounding reads through it as the asking user.';
comment on column public.articles.audience_tags is
  'Empty means visible to every member. Otherwise visible to members whose tags overlap. Grants only, never denies.';

create index articles_org_id_status_idx on public.articles (org_id, status);

create trigger articles_set_updated_at
before update on public.articles
for each row execute function public.set_updated_at();

-- published_at follows status and nothing else writes it (the column grant
-- below withholds it): set on publish, cleared on unpublish, exactly the
-- tickets timestamp construction.
create function public.articles_apply_status_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status is distinct from new.status then
    if new.status = 'published' then
      new.published_at := now();
    else
      new.published_at := null;
    end if;
  end if;
  return new;
end;
$$;

create trigger articles_apply_status_change
before update on public.articles
for each row execute function public.articles_apply_status_change();

-- ---------------------------------------------------------------------------
-- Audit vocabulary, extended by migration exactly as 013 planned: drop the
-- named constraint, add it back with the article and tag actions appended.
-- Existing rows satisfy the wider set, so this is safe on a populated log.

alter table public.audit_log drop constraint audit_log_action_allowed;
alter table public.audit_log add constraint audit_log_action_allowed check (
  action in (
    'member_role_changed',
    'api_key_added',
    'api_key_replaced',
    'api_key_deleted',
    'monitor_deleted',
    'article_created',
    'article_published',
    'article_unpublished',
    'article_updated',
    'article_deleted',
    'member_tags_changed'
  )
);

-- Article fanout, the 013 definer pattern. Mapping rule for updates: a
-- status transition IS the action (published or unpublished), so one save
-- produces exactly one row even when it also edits fields; only a save that
-- changes fields without changing status records article_updated. Detail
-- carries the title and the changed field names, never body content: the
-- body is not read into the detail anywhere below.
create function public.articles_write_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed text[];
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (org_id, action, actor, detail)
    values (new.org_id, 'article_created', public.clerk_user_id(),
            jsonb_build_object('title', new.title));
  elsif tg_op = 'UPDATE' then
    if old.status = 'draft' and new.status = 'published' then
      insert into public.audit_log (org_id, action, actor, detail)
      values (new.org_id, 'article_published', public.clerk_user_id(),
              jsonb_build_object('title', new.title));
    elsif old.status = 'published' and new.status = 'draft' then
      insert into public.audit_log (org_id, action, actor, detail)
      values (new.org_id, 'article_unpublished', public.clerk_user_id(),
              jsonb_build_object('title', new.title));
    else
      v_changed := array_remove(array[
        case when old.title is distinct from new.title then 'title' end,
        case when old.body is distinct from new.body then 'body' end,
        case when old.category is distinct from new.category then 'category' end,
        case when old.audience_tags is distinct from new.audience_tags then 'audience_tags' end
      ], null);
      if coalesce(array_length(v_changed, 1), 0) > 0 then
        insert into public.audit_log (org_id, action, actor, detail)
        values (new.org_id, 'article_updated', public.clerk_user_id(),
                jsonb_build_object('title', new.title, 'changed', to_jsonb(v_changed)));
      end if;
    end if;
  else
    -- Deletes fire during an org cascade too; skip when the org row is
    -- already gone (the 013 construction), the log cascades away with it.
    if exists (select 1 from public.organizations where id = old.org_id) then
      insert into public.audit_log (org_id, action, actor, detail)
      values (old.org_id, 'article_deleted', public.clerk_user_id(),
              jsonb_build_object('title', old.title));
    end if;
  end if;
  return null;
end;
$$;

create trigger articles_write_audit
after insert or update or delete on public.articles
for each row execute function public.articles_write_audit();

-- Tag assignment fanout. Detail carries the target user and the tag names
-- as assigned, so the log answers who retagged whom to what.
create function public.audit_org_members_tags_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.tags is distinct from new.tags
     and exists (select 1 from public.organizations where id = new.org_id) then
    insert into public.audit_log (org_id, action, actor, detail)
    values (
      new.org_id,
      'member_tags_changed',
      public.clerk_user_id(),
      jsonb_build_object('target_user_id', new.clerk_user_id, 'tags', to_jsonb(new.tags))
    );
  end if;
  return null;
end;
$$;

create trigger audit_org_members_tags_change
after update on public.org_members
for each row execute function public.audit_org_members_tags_change();

-- ---------------------------------------------------------------------------
-- RLS. Enabled before any policy so a mistake below fails closed, not open.

alter table public.articles enable row level security;

-- THE MEMBER READ POLICY, the visibility contract. A published, same org
-- article whose audience is empty (everyone) or overlaps the reader's own
-- tags. A member outside the audience gets no row, no count, no error:
-- nothing to indicate existence. Drafts match nothing here regardless of
-- tags.
create policy "members read published articles their tags admit"
on public.articles
for select
to authenticated
using (
  org_id in (
    select id from public.organizations
    where clerk_org_id = (select public.clerk_active_org_id())
  )
  and status = 'published'
  and (
    cardinality(audience_tags) = 0
    or audience_tags && (select public.member_audience_tags())
  )
);

-- Admins see every article in their org including drafts, regardless of
-- audience: they write the articles, so there is nothing to hide from them.
create policy "org admins read all their org's articles"
on public.articles
for select
to authenticated
using (
  org_id in (
    select id from public.organizations
    where clerk_org_id = (select public.clerk_active_org_id())
  )
  and public.is_org_admin(org_id)
);

-- Writes are admin only, in the org, as themselves on create.
create policy "org admins create articles"
on public.articles
for insert
to authenticated
with check (
  org_id in (
    select id from public.organizations
    where clerk_org_id = (select public.clerk_active_org_id())
  )
  and public.is_org_admin(org_id)
  and created_by = (select public.clerk_user_id())
);

create policy "org admins update articles"
on public.articles
for update
to authenticated
using (
  org_id in (
    select id from public.organizations
    where clerk_org_id = (select public.clerk_active_org_id())
  )
  and public.is_org_admin(org_id)
)
with check (
  org_id in (
    select id from public.organizations
    where clerk_org_id = (select public.clerk_active_org_id())
  )
  and public.is_org_admin(org_id)
);

create policy "org admins delete articles"
on public.articles
for delete
to authenticated
using (
  org_id in (
    select id from public.organizations
    where clerk_org_id = (select public.clerk_active_org_id())
  )
  and public.is_org_admin(org_id)
);

-- ---------------------------------------------------------------------------
-- GRANTs. Migration 003 pattern: revoke everything, grant back exactly the
-- verbs and columns each role needs. anon gets nothing: articles are never
-- public, and the status page precedent does not extend here.

revoke all on table public.articles from anon, authenticated;
grant select on table public.articles to authenticated;
-- Insert without status or timestamps: every article is born a draft by the
-- column default, and published_at is trigger managed.
grant insert (org_id, title, body, category, audience_tags, created_by)
  on table public.articles to authenticated;
-- Update reaches the editable fields and status (publish, unpublish);
-- created_by, published_at, and the identity columns stay out of reach.
grant update (title, body, category, audience_tags, status)
  on table public.articles to authenticated;
grant delete on table public.articles to authenticated;
grant all on table public.articles to service_role;

-- Trigger functions fire regardless of the caller's execute privilege;
-- nothing calls them directly, so nobody may.
revoke execute on function public.articles_apply_status_change() from public, anon, authenticated;
revoke execute on function public.articles_write_audit() from public, anon, authenticated;
revoke execute on function public.audit_org_members_tags_change() from public, anon, authenticated;
