import { createHmac } from 'node:crypto'

import { createClient } from '@supabase/supabase-js'

import type { Database } from '@/lib/db/types'

// Infrastructure for the tenant isolation suite (docs/PHASE_0_PLAN.md Task 5,
// decision recorded in docs/DECISIONS.md). The suite runs against the local
// Supabase stack defined by supabase/config.toml: real Postgres, real
// PostgREST, real RLS, no cloud credentials. Auth (GoTrue) is not running;
// instead the tests mint their own JWTs signed with the stack's JWT secret,
// carrying the same Clerk claim shapes production tokens carry. PostgREST
// only ever sees a signed token, so what gets exercised is exactly what
// production exercises: the policies in supabase/migrations/.
//
// This file lives inside tests/isolation/ deliberately: CLAUDE.md rule 8
// (never skip, weaken, or delete these tests) covers the harness too.

// The Supabase CLI's fixed, published local development JWT secret. It is not
// a credential: it is baked into every `supabase start` stack on every
// machine and grants nothing outside a loopback Docker stack.
const LOCAL_DEV_JWT_SECRET =
  'super-secret-jwt-token-with-at-least-32-characters-long' // gitleaks:allow

const SUPABASE_URL =
  process.env.TALVEX_TEST_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const JWT_SECRET =
  process.env.TALVEX_TEST_SUPABASE_JWT_SECRET ?? LOCAL_DEV_JWT_SECRET

// ---------------------------------------------------------------------------
// JWT minting. HS256 is ~15 lines of node:crypto; a JWT library would be a
// dependency for the sake of a dependency.

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}

function signHS256(payload: Record<string, unknown>): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = base64url(JSON.stringify(payload))
  const signature = createHmac('sha256', JWT_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url')
  return `${header}.${body}.${signature}`
}

function baseClaims(role: string): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000)
  return {
    iss: 'supabase-demo',
    role,
    aud: 'authenticated',
    iat: now,
    exp: now + 3600,
  }
}

/**
 * The two claim shapes Clerk emits for the active organization, per
 * docs/DECISIONS.md: legacy top level `org_id`, and v2 nested `o.id`. The
 * RLS helper clerk_active_org_id() coalesces both, so the suite runs every
 * assertion under each shape separately; a regression in either half of the
 * coalesce fails the suite.
 */
export const CLAIM_SHAPES = ['legacy', 'v2'] as const
export type ClaimShape = (typeof CLAIM_SHAPES)[number]

export function memberToken(opts: {
  clerkUserId: string
  clerkOrgId: string
  shape: ClaimShape
}): string {
  const orgClaims =
    opts.shape === 'legacy'
      ? { org_id: opts.clerkOrgId, org_role: 'org:member' }
      : { o: { id: opts.clerkOrgId, rol: 'member' } }
  return signHS256({
    ...baseClaims('authenticated'),
    sub: opts.clerkUserId,
    ...orgClaims,
  })
}

/**
 * A signed in session with NO active organization: the hidePersonal failure
 * mode documented in docs/DECISIONS.md. Every tenant query under this token
 * must return zero rows, silently.
 */
export function orglessToken(clerkUserId: string): string {
  return signHS256({ ...baseClaims('authenticated'), sub: clerkUserId })
}

// ---------------------------------------------------------------------------
// Clients. These mirror src/lib/db/ exactly: the member client is shaped like
// createOrgScopedClient (anon key + accessToken), the service client like
// createAdminClient (service role key as the key). The app modules themselves
// are not importable here because they read Clerk session state and app env.

function serviceRoleToken(): string {
  return signHS256(baseClaims('service_role'))
}

function anonKey(): string {
  return signHS256(baseClaims('anon'))
}

export type TestClient = ReturnType<typeof createServiceClient>

/** Bypasses RLS, exactly like the webhook's admin client. Seeding only. */
export function createServiceClient() {
  return createClient<Database>(SUPABASE_URL, serviceRoleToken(), {
    auth: { persistSession: false },
  })
}

/** Runs every query AS the token's user, under RLS, like the app does. */
export function createMemberClient(token: string) {
  return createClient<Database>(SUPABASE_URL, anonKey(), {
    accessToken: async () => token,
    auth: { persistSession: false },
  })
}

// ---------------------------------------------------------------------------
// Preflight. CLAUDE.md rule 8: this suite must never be skipped, so when its
// preconditions are missing it FAILS, loudly, with the exact command that
// fixes it. A skip here would make green CI stop meaning "tenants are
// isolated", which is the one thing Phase 0 promises.

export async function preflight(): Promise<void> {
  let failure: string
  try {
    const { error } = await createServiceClient()
      .from('organizations')
      .select('id')
      .limit(1)
    if (!error) return
    failure = `${error.code ?? ''} ${error.message}`.trim()
  } catch (err) {
    failure = err instanceof Error ? `${err.message} ${String(err.cause ?? '')}` : String(err)
  }

  const hint = /fetch failed|ECONNREFUSED|ENOTFOUND|socket/i.test(failure)
    ? 'The local Supabase stack is not running. Start it with: npx supabase start (requires Docker).'
    : /PGRST205|schema cache|does not exist/i.test(failure)
      ? 'The stack is running but the schema is missing. Apply migrations with: npx supabase db reset'
      : /JW[ST]|401|signature/i.test(failure)
        ? 'The stack rejected our token: JWT secret mismatch. If supabase/config.toml auth settings changed, set TALVEX_TEST_SUPABASE_JWT_SECRET to match.'
        : /permission denied|42501/i.test(failure)
          ? 'Tables exist but API roles lack grants. The local stack must expose public tables to PostgREST roles the same way the remote project does; see supabase/config.toml.'
          : 'Unrecognized failure; inspect the stack with: npx supabase status'

  throw new Error(
    'Tenant isolation suite preflight failed.\n' +
      `  Cause: ${failure}\n` +
      `  Fix:   ${hint}\n` +
      '  This suite fails when it cannot run; it never skips (CLAUDE.md rule 8).',
  )
}
