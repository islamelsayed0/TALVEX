'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

import { autoSetTimezoneAction } from './actions'

/**
 * The zero setup timezone bootstrap. Renders nothing. On the first admin
 * visit while the org zone is unset, it reads the browser zone
 * (Intl.resolvedOptions().timeZone), persists it through the validated
 * server action, and refreshes so the stored zone drives every number from
 * then on. The server cannot see the browser zone during the first render,
 * so that view uses the fallback; this closes the gap within moments and
 * only ever runs while the zone is unset.
 */
export function AutoTimezone({ zoneIsSet }: { zoneIsSet: boolean }) {
  const router = useRouter()
  const ran = useRef(false)

  useEffect(() => {
    if (zoneIsSet || ran.current) return
    ran.current = true
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone ?? ''
    autoSetTimezoneAction(detected).then(() => router.refresh())
  }, [zoneIsSet, router])

  return null
}
