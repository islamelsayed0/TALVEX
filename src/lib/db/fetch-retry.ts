/**
 * One shot retry for Supabase's PGRST303 "JWT not yet valid".
 *
 * The failure this absorbs, observed in the dev logs and reproduced by
 * probing: Clerk mints a session token stamped with the current second, and
 * for a moment around that second Supabase's validator can sit slightly
 * behind Clerk's clock, so a brand new token is judged "not yet valid". It
 * happens on the first query after sign in, and the very same token passes
 * a second or two later. Without this wrapper that flicker crashes the
 * first server render a user sees.
 *
 * Retrying here is safe for every verb, reads and writes alike: a PGRST303
 * response means the request was rejected at the authentication layer and
 * never reached the database, so replaying it cannot double apply anything.
 * Any other status or error code passes through untouched, first try.
 */

const CLOCK_SKEW_CODE = 'PGRST303'
const RETRY_DELAY_MS = 1500

export function withClockSkewRetry(
  baseFetch: typeof fetch = fetch,
  delayMs: number = RETRY_DELAY_MS,
): typeof fetch {
  return async (input, init) => {
    const response = await baseFetch(input, init)
    if (response.status !== 401) return response

    // Reading the body consumes it, so a passed through response must be
    // rebuilt for the caller either way.
    const text = await response.text()
    let code: unknown
    try {
      code = (JSON.parse(text) as { code?: unknown }).code
    } catch {
      // Not JSON; not PostgREST's error shape.
    }
    if (code !== CLOCK_SKEW_CODE) {
      return new Response(text, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      })
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs))
    return baseFetch(input, init)
  }
}
