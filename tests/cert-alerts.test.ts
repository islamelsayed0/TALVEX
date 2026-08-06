import { describe, expect, it } from 'vitest'

import {
  certBand,
  certDaysLeft,
  decideCertAlert,
  type CertThreshold,
} from '@/lib/monitoring/cert-alerts'

// Unit suite for the certificate expiry threshold evaluation. Everything here
// is pure: instants in, decisions out, no network and no database. Day math
// runs through the same zonedWallClock authority the digest uses, which is
// what the zone cases below prove matters.

const UTC = 'UTC'

/** N days after now, at the same time of day, as an ISO string. */
function daysFromNow(nowMs: number, days: number): string {
  return new Date(nowMs + days * 24 * 60 * 60 * 1000).toISOString()
}

const NOW = Date.parse('2026-08-04T12:00:00Z')

function decide(input: {
  certExpiresAt: string | null
  previousExpiresAt?: string | null
  alertedThreshold?: CertThreshold | null
  nowMs?: number
  timeZone?: string
}) {
  return decideCertAlert({
    certExpiresAt: input.certExpiresAt,
    previousExpiresAt: input.previousExpiresAt ?? input.certExpiresAt,
    alertedThreshold: input.alertedThreshold ?? null,
    nowMs: input.nowMs ?? NOW,
    timeZone: input.timeZone ?? UTC,
  })
}

describe('certBand', () => {
  it('is null outside the warning window', () => {
    expect(certBand(daysFromNow(NOW, 15), NOW, UTC)).toBeNull()
    expect(certBand(daysFromNow(NOW, 120), NOW, UTC)).toBeNull()
  })

  it('is 14d at exactly 14 days and 3d at exactly 3', () => {
    expect(certBand(daysFromNow(NOW, 14), NOW, UTC)).toBe('14d')
    expect(certBand(daysFromNow(NOW, 4), NOW, UTC)).toBe('14d')
    expect(certBand(daysFromNow(NOW, 3), NOW, UTC)).toBe('3d')
    expect(certBand(daysFromNow(NOW, 1), NOW, UTC)).toBe('3d')
  })

  it('is expired the moment the instant passes, not the local date', () => {
    // One hour past expiry, still the same UTC calendar day: the certificate
    // is already invalid, so the band is expired even though daysLeft is 0.
    const expiry = '2026-08-04T10:00:00Z'
    expect(certDaysLeft(expiry, NOW, UTC)).toBe(0)
    expect(certBand(expiry, NOW, UTC)).toBe('expired')
  })

  it('is null for a null or unparseable expiry', () => {
    expect(certBand(null, NOW, UTC)).toBeNull()
    expect(certBand('not a date', NOW, UTC)).toBeNull()
  })

  it('depends on the org timezone, because days are local calendar days', () => {
    // The same pair of instants: late evening in Auckland (already the 4th),
    // with an expiry that lands just past midnight there on the 19th. In
    // Auckland that is 15 calendar days away, outside the window; in New York
    // both instants sit inside the same dates 14 days apart, inside it.
    const now = Date.parse('2026-08-04T11:00:00Z')
    const expiry = '2026-08-18T13:00:00Z'
    expect(certDaysLeft(expiry, now, 'Pacific/Auckland')).toBe(15)
    expect(certBand(expiry, now, 'Pacific/Auckland')).toBeNull()
    expect(certDaysLeft(expiry, now, 'America/New_York')).toBe(14)
    expect(certBand(expiry, now, 'America/New_York')).toBe('14d')
  })

  it('counts calendar days across a daylight saving jump', () => {
    // New York springs forward on 2026-03-08. The elapsed hours are not a
    // multiple of 24, but the local calendar still says three days.
    const now = Date.parse('2026-03-07T17:00:00Z')
    const expiry = '2026-03-10T17:00:00Z'
    expect(certDaysLeft(expiry, now, 'America/New_York')).toBe(3)
    expect(certBand(expiry, now, 'America/New_York')).toBe('3d')
  })
})

describe('decideCertAlert', () => {
  it('does nothing while the certificate is healthy', () => {
    const result = decide({ certExpiresAt: daysFromNow(NOW, 60) })
    expect(result).toEqual({ notify: null, newAlertedThreshold: null })
  })

  it('notifies 14d once on crossing, then stays quiet inside the band', () => {
    const expiry = daysFromNow(NOW, 10)
    expect(decide({ certExpiresAt: expiry })).toEqual({
      notify: '14d',
      newAlertedThreshold: '14d',
    })
    expect(decide({ certExpiresAt: expiry, alertedThreshold: '14d' })).toEqual({
      notify: null,
      newAlertedThreshold: '14d',
    })
  })

  it('notifies each deeper crossing exactly once', () => {
    const expiry = daysFromNow(NOW, 2)
    expect(decide({ certExpiresAt: expiry, alertedThreshold: '14d' })).toEqual({
      notify: '3d',
      newAlertedThreshold: '3d',
    })
    const past = daysFromNow(NOW, -1)
    expect(decide({ certExpiresAt: past, alertedThreshold: '3d' })).toEqual({
      notify: 'expired',
      newAlertedThreshold: 'expired',
    })
    expect(decide({ certExpiresAt: past, alertedThreshold: 'expired' })).toEqual({
      notify: null,
      newAlertedThreshold: 'expired',
    })
  })

  it('sends only the deepest band when a cert is first seen already close', () => {
    // Straight to 2 days out: one notification, the 3d one, never both.
    const result = decide({ certExpiresAt: daysFromNow(NOW, 2) })
    expect(result).toEqual({ notify: '3d', newAlertedThreshold: '3d' })
  })

  it('resets the ledger when the certificate is renewed', () => {
    // Renewed to a healthy expiry: the ledger clears and nothing is sent, so
    // next year's lapse alerts again from scratch.
    const result = decide({
      certExpiresAt: daysFromNow(NOW, 300),
      previousExpiresAt: daysFromNow(NOW, 2),
      alertedThreshold: '3d',
    })
    expect(result).toEqual({ notify: null, newAlertedThreshold: null })
  })

  it('alerts afresh when a renewal is still inside the window', () => {
    const result = decide({
      certExpiresAt: daysFromNow(NOW, 10),
      previousExpiresAt: daysFromNow(NOW, 1),
      alertedThreshold: '3d',
    })
    expect(result).toEqual({ notify: '14d', newAlertedThreshold: '14d' })
  })

  it('does not treat an unchanged expiry as a renewal', () => {
    const expiry = daysFromNow(NOW, 10)
    const result = decide({
      certExpiresAt: expiry,
      previousExpiresAt: expiry,
      alertedThreshold: '14d',
    })
    expect(result).toEqual({ notify: null, newAlertedThreshold: '14d' })
  })

  it('is silent with no expiry at all', () => {
    expect(decide({ certExpiresAt: null })).toEqual({
      notify: null,
      newAlertedThreshold: null,
    })
  })
})
