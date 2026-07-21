import { describe, expect, it } from 'vitest'

import { mapClerkRole } from '../src/lib/db/clerk-sync'
import { isProtectedPath } from '../src/lib/auth/routes'

// The sync handlers themselves need a live database and a service role key,
// which CI does not have; they are exercised end to end against the real
// webhook (see PR notes). What CI can hold to account is the pure logic:
// the role mapping that decides what lands in org_members.role, and the
// route rules that changed in this task.

describe('mapClerkRole', () => {
  it('maps Clerk admin roles to app admin', () => {
    expect(mapClerkRole('org:admin')).toBe('admin')
    expect(mapClerkRole('admin')).toBe('admin')
  })

  it('maps everything else to member, never owner or technician', () => {
    // owner and technician are app assigned roles; a webhook payload must
    // never be able to mint them. If someone extends the mapping, this
    // test forces them to notice that rule.
    expect(mapClerkRole('org:member')).toBe('member')
    expect(mapClerkRole('org:owner')).toBe('member')
    expect(mapClerkRole('org:technician')).toBe('member')
    expect(mapClerkRole('')).toBe('member')
    expect(mapClerkRole('anything-unknown')).toBe('member')
  })
})

describe('select-org routing', () => {
  it('requires a session for /select-org (it lists the user\'s orgs)', () => {
    expect(isProtectedPath('/select-org')).toBe(true)
  })

  it('still leaves the webhook route public: the signature is its auth', () => {
    expect(isProtectedPath('/api/webhooks/clerk')).toBe(false)
  })
})
