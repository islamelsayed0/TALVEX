'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'

/**
 * Rendered only while the billing screen is waiting for the Stripe webhook
 * to land entitlements after a successful checkout: refreshes the server
 * component every few seconds, briefly. The success redirect is never
 * trusted for entitlement state; the webhook writes it and this merely asks
 * the server again. When the state lands, the server stops rendering this
 * component and the polling dies with it. Bounded so an unconfirmed webhook
 * (misconfigured endpoint, say) degrades to a static page, not an infinite
 * poll.
 */

const INTERVAL_MS = 2500
const MAX_TRIES = 12

export function PendingRefresh() {
  const router = useRouter()
  const tries = useRef(0)

  useEffect(() => {
    const id = setInterval(() => {
      tries.current += 1
      if (tries.current > MAX_TRIES) {
        clearInterval(id)
        return
      }
      router.refresh()
    }, INTERVAL_MS)
    return () => clearInterval(id)
  }, [router])

  return null
}
