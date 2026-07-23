import { timingSafeEqual } from 'node:crypto'

/**
 * Authorization for the cron sweep route. Vercel Cron sends
 * `Authorization: Bearer <CRON_SECRET>` on every invocation when the
 * CRON_SECRET environment variable is set on the project; nothing else
 * knows the secret, so the header IS the authentication (same principle as
 * the Clerk webhook signature). Kept out of the route file so the isolation
 * suite can exercise it directly; Next route files may only export HTTP
 * handlers.
 *
 * Fails closed: no configured secret means every request is rejected,
 * including when someone forgets to set the env var in a new environment.
 */
export function isAuthorizedCronRequest(
  request: Request,
  secret: string | undefined = process.env.CRON_SECRET,
): boolean {
  if (!secret) return false

  const header = request.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return false

  const presented = Buffer.from(header.slice('Bearer '.length))
  const expected = Buffer.from(secret)
  return (
    presented.length === expected.length && timingSafeEqual(presented, expected)
  )
}
