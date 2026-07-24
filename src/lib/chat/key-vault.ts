import 'server-only'

import { createAdminClient } from '@/lib/db/admin'
import type { AiProvider } from '@/lib/db/types'
import { decryptApiKey } from './encryption'

/**
 * Reads and decrypts an org's provider key for a single provider call (Task 5
 * ruling 2/3). This is the ONLY place the plaintext key exists after save.
 *
 * Why the service role: the encrypted_key column is withheld from the
 * authenticated SELECT grant (migration 007), so no user session, not even an
 * admin's, can read the ciphertext. The chat send path runs for any member, so
 * it cannot read the key under the member's RLS; it reads it here through the
 * narrow service role exception (see the allowlist in admin.ts), by org uuid
 * and provider, then decrypts in request scope.
 *
 * The returned plaintext is used immediately for one provider call and then
 * goes out of scope. It is never stored, never cached, and never logged.
 */
export async function readProviderKey(
  orgUuid: string,
  provider: AiProvider,
): Promise<string | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('org_api_keys')
    .select('encrypted_key')
    .eq('org_id', orgUuid)
    .eq('provider', provider)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return decryptApiKey(data.encrypted_key)
}
