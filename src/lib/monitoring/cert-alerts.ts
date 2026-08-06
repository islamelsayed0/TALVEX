import { zonedWallClock } from '@/lib/db/usage'

/**
 * Certificate expiry threshold evaluation. Pure, like the incident engine's
 * decide(): the cron sweep feeds in what the check observed and what the
 * ledger remembers, and gets back at most one threshold to notify plus the
 * new ledger value. All I/O stays in the cron route.
 *
 * Semantics, stated once:
 *   - Days are calendar days in the org's timezone, computed with the same
 *     zonedWallClock authority the digest uses, so the two features can never
 *     disagree about how many days remain.
 *   - "expired" is decided by the instant, not the local date: a certificate
 *     is invalid the moment valid_to passes, wherever the org is.
 *   - Severity is monotone (expired > 3d > 14d) and each certificate alerts
 *     once per crossing: a cert first seen at 2 days out sends only the 3d
 *     warning, a cert sitting inside a band it already alerted for sends
 *     nothing, and crossing into a deeper band sends that band once.
 *   - Renewal resets the ledger: an expiry strictly later than the stored one
 *     means a new certificate, so next year's lapse alerts again. A renewal
 *     that is still inside 14 days legitimately alerts afresh.
 */

export type CertThreshold = '14d' | '3d' | 'expired'

const SEVERITY: Record<CertThreshold, number> = { '14d': 1, '3d': 2, expired: 3 }

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Whole calendar days between now's local date and the expiry's local date in
 * the given zone. Zero means the cert expires today; negative means the
 * expiry date has passed.
 */
export function certDaysLeft(
  certExpiresAt: string,
  nowMs: number,
  timeZone: string,
): number {
  const nowWall = zonedWallClock(nowMs, timeZone)
  const expiryWall = zonedWallClock(Date.parse(certExpiresAt), timeZone)
  const nowDate = Date.UTC(nowWall.year, nowWall.month - 1, nowWall.day)
  const expiryDate = Date.UTC(
    expiryWall.year,
    expiryWall.month - 1,
    expiryWall.day,
  )
  return Math.round((expiryDate - nowDate) / DAY_MS)
}

/** The warning band a certificate is in right now, or null when healthy. */
export function certBand(
  certExpiresAt: string | null,
  nowMs: number,
  timeZone: string,
): CertThreshold | null {
  if (certExpiresAt === null) return null
  const expiryMs = Date.parse(certExpiresAt)
  if (Number.isNaN(expiryMs)) return null
  if (nowMs >= expiryMs) return 'expired'
  const daysLeft = certDaysLeft(certExpiresAt, nowMs, timeZone)
  if (daysLeft <= 3) return '3d'
  if (daysLeft <= 14) return '14d'
  return null
}

export type CertAlertDecision = {
  /** The threshold to notify this sweep, or null for silence. */
  notify: CertThreshold | null
  /** What the ledger should hold after this sweep. */
  newAlertedThreshold: CertThreshold | null
}

export function decideCertAlert(input: {
  /** The expiry about to be stored, after this sweep's capture rules. */
  certExpiresAt: string | null
  /** The expiry stored before this sweep, for renewal detection. */
  previousExpiresAt: string | null
  alertedThreshold: CertThreshold | null
  nowMs: number
  timeZone: string
}): CertAlertDecision {
  if (input.certExpiresAt === null) {
    return { notify: null, newAlertedThreshold: null }
  }

  const renewed =
    input.previousExpiresAt !== null &&
    Date.parse(input.certExpiresAt) > Date.parse(input.previousExpiresAt)
  const alerted = renewed ? null : input.alertedThreshold

  const band = certBand(input.certExpiresAt, input.nowMs, input.timeZone)
  if (band === null) {
    // Healthy. A renewal lands here and clears the ledger for the new cert.
    return { notify: null, newAlertedThreshold: renewed ? null : alerted }
  }

  const crossed = alerted === null || SEVERITY[band] > SEVERITY[alerted]
  return {
    notify: crossed ? band : null,
    newAlertedThreshold: crossed ? band : alerted,
  }
}
