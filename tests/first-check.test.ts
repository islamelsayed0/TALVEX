import { describe, expect, it } from 'vitest'

import { runFirstCheck } from '@/lib/monitoring/first-check'
import type { CheckOutcome } from '@/lib/monitoring/check'

// Unit suite for the immediate first check (docs/future_update.md). The
// checker and the admin client are injected, so this proves the write shapes
// and the never throw discipline without a network or a database; the write
// PATH itself (service role only columns) is proven by the isolation suite,
// and the checker by the cert capture and sweep tests.

const MONITOR = {
  id: 'mon-1',
  org_id: 'org-1',
  url: 'https://example.com/',
}

const UP: CheckOutcome = {
  status: 'up',
  responseTimeMs: 120,
  errorMessage: null,
  certExpiresAt: '2027-07-01T12:00:00.000Z',
}

/** A stub of the two table writes the first check performs. */
function fakeDb() {
  const inserts: { table: string; row: Record<string, unknown> }[] = []
  const updates: { table: string; row: Record<string, unknown>; id: string }[] = []
  let failInsert = false
  const db = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          inserts.push({ table, row })
          return Promise.resolve(
            failInsert ? { error: { message: 'boom' } } : { error: null },
          )
        },
        update(row: Record<string, unknown>) {
          return {
            eq(_col: string, id: string) {
              updates.push({ table, row, id })
              return Promise.resolve({ error: null })
            },
          }
        },
      }
    },
  }
  return {
    db,
    inserts,
    updates,
    setFailInsert() {
      failInsert = true
    },
  }
}

describe('runFirstCheck', () => {
  it('records the check and stamps the monitor, cert expiry included', async () => {
    const fake = fakeDb()
    await runFirstCheck(MONITOR, {
      check: async () => UP,
      db: () => fake.db as never,
    })

    expect(fake.inserts).toHaveLength(1)
    expect(fake.inserts[0].table).toBe('monitor_checks')
    expect(fake.inserts[0].row).toMatchObject({
      monitor_id: 'mon-1',
      org_id: 'org-1',
      status: 'up',
      response_time_ms: 120,
      error_message: null,
    })

    expect(fake.updates).toHaveLength(1)
    expect(fake.updates[0].table).toBe('monitors')
    expect(fake.updates[0].id).toBe('mon-1')
    expect(fake.updates[0].row).toMatchObject({
      last_status: 'up',
      cert_expires_at: '2027-07-01T12:00:00.000Z',
    })
    expect(typeof fake.updates[0].row.last_checked_at).toBe('string')
  })

  it('stamps a down outcome the same way and never touches cert on a null read', async () => {
    const fake = fakeDb()
    await runFirstCheck(MONITOR, {
      check: async () => ({
        status: 'down',
        responseTimeMs: null,
        errorMessage: 'Connection failed: ENOTFOUND',
        certExpiresAt: null,
      }),
      db: () => fake.db as never,
    })

    expect(fake.inserts[0].row).toMatchObject({
      status: 'down',
      error_message: 'Connection failed: ENOTFOUND',
    })
    expect(fake.updates[0].row).toMatchObject({ last_status: 'down' })
    expect('cert_expires_at' in fake.updates[0].row).toBe(false)
  })

  it('never throws: a checker crash is swallowed and nothing is written', async () => {
    const fake = fakeDb()
    await expect(
      runFirstCheck(MONITOR, {
        check: async () => {
          throw new Error('checker died')
        },
        db: () => fake.db as never,
      }),
    ).resolves.toBeUndefined()
    expect(fake.inserts).toHaveLength(0)
    expect(fake.updates).toHaveLength(0)
  })

  it('never throws: a write failure is swallowed and the status stamp is skipped', async () => {
    const fake = fakeDb()
    fake.setFailInsert()
    await expect(
      runFirstCheck(MONITOR, {
        check: async () => UP,
        db: () => fake.db as never,
      }),
    ).resolves.toBeUndefined()
    // The insert failed, so the monitor stamp never ran: last_checked_at
    // stays null and the next sweep treats the monitor as due immediately.
    expect(fake.updates).toHaveLength(0)
  })
})
