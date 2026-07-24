import { getActiveOrgViewer } from '@/lib/auth/org-viewer'
import { UNKNOWN_MEMBER, resolveUserNames } from '@/lib/auth/user-names'
import { AI_PROVIDER_LABELS } from '@/lib/chat/providers-meta'
import { AI_PROVIDERS, listApiKeyEvents, listApiKeys } from '@/lib/db/api-keys'
import type { AiProvider, ApiKeyEventType } from '@/lib/db/types'
import { formatUtc, ghostButton, primaryButton } from '../../monitors/ui'
import { FormError, ticketFieldClass } from '../../tickets/ui'
import { deleteApiKeyAction, saveApiKeyAction } from './actions'

export const metadata = { title: 'API keys — Talvex' }

const EVENT_LABEL: Record<ApiKeyEventType, string> = {
  added: 'Key added',
  replaced: 'Key replaced',
  deleted: 'Key removed',
}

/**
 * BYOK key management, admin only (ruling 6). Members never reach the content:
 * RLS returns nothing, and the page shows a calm "admins only" note instead of
 * an empty admin UI. The key is never shown; the list carries provider and last
 * four only, and there is no reveal. Save runs a validation call first (ruling
 * 5), so a bad key is rejected with a calm message and never saved.
 */
export default async function ApiKeysPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const asString = (v: string | string[] | undefined) =>
    typeof v === 'string' ? v : ''

  const viewer = await getActiveOrgViewer()
  if (!viewer.isAdmin) {
    return (
      <main className="flex flex-1 flex-col gap-6 p-8">
        <div>
          <h1 className="text-title text-foreground">API keys</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Key management is available to admins. Ask an admin to add or change
            the provider key for the assistant.
          </p>
        </div>
      </main>
    )
  }

  const [keys, events] = await Promise.all([listApiKeys(), listApiKeyEvents()])
  const names = await resolveUserNames([
    ...keys.map((k) => k.addedBy),
    ...events.map((e) => e.actor),
  ])
  const nameOf = (id: string) => names.get(id) ?? UNKNOWN_MEMBER

  const savedProvider = asString(sp.saved)
  const removedProvider = asString(sp.removed)
  const errorProvider = asString(sp.provider)
  const error = asString(sp.error)

  const banner = savedProvider
    ? `Saved. The ${AI_PROVIDER_LABELS[savedProvider as AiProvider] ?? savedProvider} key is ready.`
    : removedProvider
      ? `Removed the ${AI_PROVIDER_LABELS[removedProvider as AiProvider] ?? removedProvider} key.`
      : null

  const configured = new Set(keys.map((k) => k.provider))

  return (
    <main className="flex flex-1 flex-col gap-8 p-8">
      <div>
        <h1 className="text-title text-foreground">API keys</h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          The assistant runs on your own AI provider key. Keys are encrypted, are
          never shown again after you save, and are used only on the server. Add
          one key per provider.
        </p>
      </div>

      {banner ? (
        <p className="max-w-2xl rounded-button border border-border bg-card px-5 py-4 text-sm text-card-foreground">
          {banner}
        </p>
      ) : null}

      {/* Add or replace */}
      <section className="max-w-2xl">
        <h2 className="text-base font-semibold text-foreground">Add a key</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          We check the key with the provider before saving. Adding a key for a
          provider that already has one replaces it.
        </p>
        <form
          action={saveApiKeyAction}
          className="mt-4 flex flex-col gap-4"
          autoComplete="off"
        >
          <FormError message={error || undefined} />
          <label className="flex flex-col gap-1.5">
            <span className="text-sm text-muted-foreground">Provider</span>
            <select
              name="provider"
              defaultValue={errorProvider || AI_PROVIDERS[0]}
              className={`${ticketFieldClass} h-12 appearance-none`}
            >
              {AI_PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {AI_PROVIDER_LABELS[p]}
                  {configured.has(p) ? ' (replace)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm text-muted-foreground">Key</span>
            <input
              name="key"
              type="password"
              required
              autoComplete="off"
              placeholder="Paste your provider key"
              className={`${ticketFieldClass} h-12`}
            />
          </label>
          <div>
            <button type="submit" className={primaryButton}>
              Validate and save
            </button>
          </div>
        </form>
      </section>

      {/* Configured keys */}
      <section className="max-w-2xl">
        <h2 className="text-base font-semibold text-foreground">Configured keys</h2>
        {keys.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No keys yet. Add one above to turn on the assistant.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {keys.map((k) => (
              <li
                key={k.provider}
                className="flex flex-wrap items-center justify-between gap-3 rounded-button border border-border bg-card px-5 py-4"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-card-foreground">
                    {AI_PROVIDER_LABELS[k.provider]} · ending in {k.keyLastFour}
                  </span>
                  <span className="text-xs text-quiet">
                    Added by {nameOf(k.addedBy)} · {formatUtc(k.updatedAt)}
                  </span>
                </div>
                <form action={deleteApiKeyAction}>
                  <input type="hidden" name="provider" value={k.provider} />
                  <button type="submit" className={`${ghostButton} px-3 py-2`}>
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* The key trail */}
      <section className="max-w-2xl">
        <h2 className="text-base font-semibold text-foreground">Activity</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Every key change, oldest first. Times are UTC.
        </p>
        {events.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Nothing yet.</p>
        ) : (
          <ol className="mt-4 flex flex-col gap-3">
            {events.map((e) => (
              <li
                key={e.id}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-2 py-1"
              >
                <span className="text-sm text-muted-foreground">
                  {EVENT_LABEL[e.event_type as ApiKeyEventType]} ·{' '}
                  {AI_PROVIDER_LABELS[e.provider as AiProvider] ?? e.provider} ending
                  in {e.key_last_four}
                </span>
                <span className="text-xs text-quiet">
                  {nameOf(e.actor)}, {formatUtc(e.occurred_at)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  )
}
