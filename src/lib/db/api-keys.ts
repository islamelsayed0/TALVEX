import { auth } from '@clerk/nextjs/server'

import { encryptApiKey, lastFour } from '@/lib/chat/encryption'
import { AI_PROVIDERS, isAiProvider } from '@/lib/chat/providers-meta'
import { ProviderError, validateKey } from '@/lib/chat/providers'
import { createOrgScopedClient } from './client'
import { OrgNotSyncedError } from './monitors'
import type { AiProvider, ApiKeyEvent } from './types'

/**
 * Typed data layer for the BYOK key vault (Task 5, CLAUDE.md code rule 7).
 * Everything here runs on the org scoped client, so RLS has already applied the
 * admin only rule (migration 007) before any code sees a row: a member reaches
 * nothing here. The ciphertext column is not even in the SELECT grant, so this
 * layer never reads or returns it; the plaintext key is read only by the chat
 * engine, through the service role, at call time.
 *
 * Presence for members (the AI door, the provider picker) does NOT go through
 * the table. It goes through two SECURITY DEFINER functions that answer "which
 * providers" and "any key at all" without granting table access.
 */

export { AI_PROVIDERS, isAiProvider }

/** A key as shown in the admin UI: provider and last four, never the key. */
export type ApiKeySummary = {
  provider: AiProvider
  keyLastFour: string
  addedBy: string
  createdAt: string
  updatedAt: string
}

/** Input validation failed, or the provider rejected the key. Safe to display. */
export class ApiKeyValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ApiKeyValidationError'
  }
}

async function activeOrgUuid(): Promise<string> {
  const { client, orgId } = await createOrgScopedClient()
  const { data, error } = await client
    .from('organizations')
    .select('id')
    .eq('clerk_org_id', orgId)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new OrgNotSyncedError()
  return data.id
}

/**
 * The keys configured for the active org, admin only by RLS. Provider and last
 * four only; the ciphertext is unreadable through this client by design.
 */
export async function listApiKeys(): Promise<ApiKeySummary[]> {
  const { client } = await createOrgScopedClient()
  const { data, error } = await client
    .from('org_api_keys')
    .select('provider, key_last_four, added_by, created_at, updated_at')
    .order('provider', { ascending: true })
  if (error) throw error
  return data.map((row) => ({
    provider: row.provider as AiProvider,
    keyLastFour: row.key_last_four,
    addedBy: row.added_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

/** The key management trail for the active org, admin only, newest last. */
export async function listApiKeyEvents(): Promise<ApiKeyEvent[]> {
  const { client } = await createOrgScopedClient()
  const { data, error } = await client
    .from('api_key_events')
    .select()
    .order('occurred_at', { ascending: true })
  if (error) throw error
  return data
}

/**
 * The providers the active org has a key for, via the SECURITY DEFINER helper,
 * so a member can drive the chat provider picker without any table access.
 */
export async function listKeyProviders(): Promise<AiProvider[]> {
  const { client } = await createOrgScopedClient()
  const { data, error } = await client.rpc('org_api_key_providers')
  if (error) throw error
  return (data ?? []).filter(isAiProvider)
}

/** True when the active org has at least one provider key. Drives the AI door. */
export async function orgHasKey(): Promise<boolean> {
  const { client } = await createOrgScopedClient()
  const { data, error } = await client.rpc('org_has_api_key')
  if (error) throw error
  return data === true
}

/**
 * Add a provider key, or replace the existing one for that provider. Validated
 * against the provider before it is saved (ruling 5): a minimal test call on
 * the customer's key; only success saves. The plaintext is encrypted here
 * (AES 256 GCM) and never persisted in the clear. RLS makes this admin only;
 * for anyone else the insert or update matches zero rows and OrgNotSynced or a
 * silent no op results, so this layer does not re-check the role.
 */
export async function saveApiKey(
  provider: string,
  rawKey: string,
): Promise<void> {
  if (!isAiProvider(provider)) {
    throw new ApiKeyValidationError('Choose a supported provider.')
  }
  const key = rawKey.trim()
  if (key === '') {
    throw new ApiKeyValidationError('Paste your provider key.')
  }
  if (key.length < 8) {
    throw new ApiKeyValidationError('That key looks too short. Paste the full key.')
  }

  // Validate before saving: a rejected key never reaches the database.
  try {
    await validateKey(provider, key)
  } catch (err) {
    if (err instanceof ProviderError) {
      throw new ApiKeyValidationError(err.message)
    }
    throw err
  }

  const orgUuid = await activeOrgUuid()
  const { client } = await createOrgScopedClient()
  const { userId } = await auth()
  if (!userId) throw new Error('No signed in user on this session.')

  const encrypted = encryptApiKey(key)
  const four = lastFour(key)

  // Select then write, so INSERT vs UPDATE is explicit and the trail trigger
  // records added vs replaced correctly, and so the write touches only the
  // columns each verb's grant allows (org_id/provider are never re-set on
  // update). RLS refuses both for a non admin.
  const { data: existing, error: exErr } = await client
    .from('org_api_keys')
    .select('id')
    .eq('org_id', orgUuid)
    .eq('provider', provider)
    .maybeSingle()
  if (exErr) throw exErr

  if (existing) {
    const { error } = await client
      .from('org_api_keys')
      .update({ encrypted_key: encrypted, key_last_four: four, added_by: userId })
      .eq('org_id', orgUuid)
      .eq('provider', provider)
    if (error) throw error
  } else {
    const { error } = await client.from('org_api_keys').insert({
      org_id: orgUuid,
      provider,
      encrypted_key: encrypted,
      key_last_four: four,
      added_by: userId,
    })
    if (error) throw error
  }
}

/** Remove the key for a provider. Admin only by RLS; the trail records it. */
export async function deleteApiKey(provider: string): Promise<void> {
  if (!isAiProvider(provider)) {
    throw new ApiKeyValidationError('Choose a supported provider.')
  }
  const orgUuid = await activeOrgUuid()
  const { client } = await createOrgScopedClient()
  const { error } = await client
    .from('org_api_keys')
    .delete()
    .eq('org_id', orgUuid)
    .eq('provider', provider)
  if (error) throw error
}
