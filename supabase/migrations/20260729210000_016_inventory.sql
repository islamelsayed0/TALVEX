-- Migration 016: inventory (F15).
--
-- One table: inventory_items, the org's physical IT stock (machines,
-- printers, spares, cables, toner). Shape ported from the Help_me inventory
-- module: name, item number, serial number, location, quantity, minimum
-- stock, buy link, notes. Low stock is DERIVED (quantity at or below
-- min_stock), computed in the data layer and never stored, so it can never
-- go stale.
--
-- Access posture, the strictest of any tenant table so far: admin only on
-- every verb. Members have no inventory surface at all this phase, and the
-- refusal is loud. Grants name Postgres roles, and both org roles arrive as
-- `authenticated`, so the grant layer alone cannot tell a member from an
-- admin; the loud refusal lives in inventory_access_gate() below, which
-- every policy calls and which raises insufficient_privilege (42501) for a
-- session that is not an org admin. A member therefore gets the same error
-- shape on select that a missing grant would produce, instead of a silent
-- empty list that reads like an empty inventory.
--
-- Audit fanout per the 013/014 definer pattern: created, updated, deleted.
-- Detail carries the item name and changed field NAMES, never notes content.

-- ---------------------------------------------------------------------------
-- The table.

create table public.inventory_items (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  name          text not null check (btrim(name) <> '' and char_length(name) <= 120),
  -- Org scoped human number ("PRN-004"). Optional; unique within the org
  -- when present (the partial unique index below). Free form otherwise.
  item_number   text check (item_number is null or (btrim(item_number) <> '' and char_length(item_number) <= 60)),
  -- Vendor serial. Free text, optional, deliberately NOT unique: real
  -- serials collide across vendors.
  serial_number text check (serial_number is null or (btrim(serial_number) <> '' and char_length(serial_number) <= 120)),
  location      text check (location is null or (btrim(location) <> '' and char_length(location) <= 120)),
  quantity      integer not null default 0 check (quantity >= 0),
  min_stock     integer not null default 0 check (min_stock >= 0),
  -- Syntactic guard only, the monitors url construction: the authoritative
  -- validation (http or https, real host, no embedded credentials) runs
  -- server side in src/lib/db/inventory.ts on every write.
  buy_url       text check (buy_url is null or (buy_url ~* '^https?://' and char_length(buy_url) <= 2048)),
  notes         text check (notes is null or char_length(notes) <= 2000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.inventory_items is
  'Physical IT stock owned by an organization (F15). Admin only on every verb; members hold no inventory surface. Low stock is derived (quantity <= min_stock) in the data layer, never stored.';
comment on column public.inventory_items.item_number is
  'Org scoped label, unique within the org when present (partial unique index). NULL means unnumbered.';
comment on column public.inventory_items.serial_number is
  'Vendor serial, free text. Deliberately not unique: real serials collide across vendors.';

create index inventory_items_org_id_idx on public.inventory_items (org_id);

-- Item numbers are unique per org, but only when present: rows without a
-- number never collide with each other.
create unique index inventory_items_org_id_item_number_key
  on public.inventory_items (org_id, item_number)
  where item_number is not null;

create trigger inventory_items_set_updated_at
before update on public.inventory_items
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- The loud refusal. Grants cannot distinguish a member from an admin (both
-- sessions run as the authenticated role), so this function is what makes
-- "members hold no verb here" observable: every policy below calls it, and
-- for any session that is not an admin of its active org it raises
-- insufficient_privilege (42501) instead of returning false. A member
-- probing the table gets the same refusal a missing grant produces, never a
-- silent empty result. Invoker rights on purpose, the is_org_admin shape:
-- the org_members select policy already scopes what it can read.

create function public.inventory_access_gate()
returns boolean
language plpgsql
stable
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.org_members m
    where m.clerk_user_id = public.clerk_user_id()
      and m.role in ('owner', 'admin')
      and m.org_id in (
        select id from public.organizations
        where clerk_org_id = public.clerk_active_org_id()
      )
  ) then
    return true;
  end if;
  raise insufficient_privilege using message = 'inventory is admin only';
end;
$$;

comment on function public.inventory_access_gate() is
  'True for an admin of the active org; raises 42501 for everyone else. Called by every inventory_items policy so a member is refused loudly on every verb, select included, which grants alone cannot express (both org roles share the authenticated Postgres role).';

-- ---------------------------------------------------------------------------
-- Audit vocabulary, extended by constraint swap exactly as 013 planned.

alter table public.audit_log drop constraint audit_log_action_allowed;
alter table public.audit_log add constraint audit_log_action_allowed check (
  action in (
    'member_role_changed',
    'api_key_added',
    'api_key_replaced',
    'api_key_deleted',
    'monitor_deleted',
    'status_page_enabled',
    'status_page_disabled',
    'status_page_slug_changed',
    'timezone_changed',
    'notification_settings_changed',
    'article_created',
    'article_published',
    'article_unpublished',
    'article_updated',
    'article_deleted',
    'member_tags_changed',
    'inventory_item_created',
    'inventory_item_updated',
    'inventory_item_deleted'
  )
);

-- Inventory fanout, the 013 definer pattern. Detail carries the item name
-- and, on update, the changed field NAMES via the jsonb diff (the
-- notification settings construction, so a column added later is covered
-- without editing this function). Notes CONTENT never reaches the log: only
-- key names are stored, and no branch reads notes into the detail.
create function public.inventory_items_write_audit()
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
    values (new.org_id, 'inventory_item_created', public.clerk_user_id(),
            jsonb_build_object('name', new.name));
  elsif tg_op = 'UPDATE' then
    select coalesce(array_agg(n.key order by n.key), '{}'::text[])
      into v_changed
    from jsonb_each(to_jsonb(new)) as n(key, value)
    where n.value is distinct from to_jsonb(old) -> n.key
      and n.key not in ('id', 'org_id', 'created_at', 'updated_at');
    if coalesce(array_length(v_changed, 1), 0) > 0 then
      insert into public.audit_log (org_id, action, actor, detail)
      values (new.org_id, 'inventory_item_updated', public.clerk_user_id(),
              jsonb_build_object('name', new.name, 'changed', to_jsonb(v_changed)));
    end if;
  else
    -- Deletes fire during an org cascade too; skip when the org row is
    -- already gone (the 013 construction), the log cascades away with it.
    if exists (select 1 from public.organizations where id = old.org_id) then
      insert into public.audit_log (org_id, action, actor, detail)
      values (old.org_id, 'inventory_item_deleted', public.clerk_user_id(),
              jsonb_build_object('name', old.name));
    end if;
  end if;
  return null;
end;
$$;

create trigger inventory_items_write_audit
after insert or update or delete on public.inventory_items
for each row execute function public.inventory_items_write_audit();

-- ---------------------------------------------------------------------------
-- RLS. Enabled before any policy so a mistake below fails closed, not open.

alter table public.inventory_items enable row level security;

-- Every verb: admin only, in the active org. In the using clauses the gate
-- is deliberately the ONLY role test: it reads the same org_members.role
-- authority as is_org_admin, and pairing the two would let the planner
-- evaluate is_org_admin first and filter a member to zero rows silently,
-- which is exactly the quiet emptiness this table refuses. Every path a
-- member can take therefore ends in the gate's 42501. The with checks keep
-- is_org_admin as the row anchored authority; a failed with check is
-- already loud (42501, row level security violation).

create policy "org admins read their org's inventory"
on public.inventory_items
for select
to authenticated
using (
  org_id in (
    select id from public.organizations
    where clerk_org_id = (select public.clerk_active_org_id())
  )
  and public.inventory_access_gate()
);

create policy "org admins create inventory in their org"
on public.inventory_items
for insert
to authenticated
with check (
  org_id in (
    select id from public.organizations
    where clerk_org_id = (select public.clerk_active_org_id())
  )
  and public.is_org_admin(org_id)
  and public.inventory_access_gate()
);

create policy "org admins update their org's inventory"
on public.inventory_items
for update
to authenticated
using (
  org_id in (
    select id from public.organizations
    where clerk_org_id = (select public.clerk_active_org_id())
  )
  and public.inventory_access_gate()
)
with check (
  org_id in (
    select id from public.organizations
    where clerk_org_id = (select public.clerk_active_org_id())
  )
  and public.is_org_admin(org_id)
);

create policy "org admins delete their org's inventory"
on public.inventory_items
for delete
to authenticated
using (
  org_id in (
    select id from public.organizations
    where clerk_org_id = (select public.clerk_active_org_id())
  )
  and public.inventory_access_gate()
);

-- ---------------------------------------------------------------------------
-- GRANTs. Migration 003 pattern: revoke everything, grant back exactly what
-- each role needs. anon gets nothing. The authenticated grants are what let
-- an ADMIN session through; a member session sharing the role is stopped by
-- the gate above, loudly, before any row is seen or touched.

revoke all on table public.inventory_items from anon, authenticated;
grant select on table public.inventory_items to authenticated;
-- Insert without timestamps: both are column defaults and updated_at is
-- trigger managed after that.
grant insert (org_id, name, item_number, serial_number, location, quantity, min_stock, buy_url, notes)
  on table public.inventory_items to authenticated;
-- Update reaches the editable fields; identity and timestamps stay out of
-- reach.
grant update (name, item_number, serial_number, location, quantity, min_stock, buy_url, notes)
  on table public.inventory_items to authenticated;
grant delete on table public.inventory_items to authenticated;
grant all on table public.inventory_items to service_role;

-- The gate is called by policies evaluating for authenticated sessions.
revoke execute on function public.inventory_access_gate() from public, anon;
grant execute on function public.inventory_access_gate() to authenticated, service_role;

-- Trigger functions fire regardless of the caller's execute privilege;
-- nothing calls them directly, so nobody may.
revoke execute on function public.inventory_items_write_audit() from public, anon, authenticated;
