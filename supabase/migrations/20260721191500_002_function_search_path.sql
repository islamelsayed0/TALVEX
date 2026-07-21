-- Migration 002: pin search_path on the claim helper functions.
--
-- Supabase's security linter flagged both helpers from migration 001:
-- "Function Search Path Mutable". A function without a pinned search_path
-- resolves unqualified names against the caller's path, which a hostile role
-- can point at a schema it controls. These two functions gate every RLS
-- policy, so they get an empty search_path and fully qualified references.
-- https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable

create or replace function public.clerk_active_org_id()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt()->>'org_id', auth.jwt()->'o'->>'id')
$$;

create or replace function public.clerk_is_org_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt()->>'org_role', auth.jwt()->'o'->>'rol')
         in ('org:admin', 'admin', 'org:owner', 'owner')
$$;
