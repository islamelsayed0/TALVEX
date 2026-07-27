import { afterEach, describe, expect, it } from 'vitest'

import { AdminConfigError, createAdminClient } from '../src/lib/db/admin'

/**
 * The chat send path builds the service role client to read the org's key. When
 * the deployment is missing SUPABASE_SERVICE_ROLE_KEY, that must be a typed
 * AdminConfigError so the chat route can answer "not fully set up" instead of a
 * generic "something went wrong" (which is what production showed until this).
 */
describe('createAdminClient config guard', () => {
  const savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  afterEach(() => {
    if (savedKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY
    else process.env.SUPABASE_SERVICE_ROLE_KEY = savedKey
  })

  it('throws a typed AdminConfigError when the service role key is missing', () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    expect(() => createAdminClient()).toThrowError(AdminConfigError)
  })
})
