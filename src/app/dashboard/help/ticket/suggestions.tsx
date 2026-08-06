'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * The ticket form's two fields, as a client island so a draft can surface
 * document suggestions while the member types. The inputs keep their names
 * and sit inside the page's server action form, so submission is exactly the
 * round trip it always was; this component adds only the strip beneath.
 *
 * Contract (the queue's rulings):
 *   - Debounced, one retrieval request in flight at a time: a new keystroke
 *     cancels the pending timer, and a new request aborts the previous one.
 *   - A member with no admitted documents sees NOTHING. No empty state, no
 *     heading, no hint the feature exists; a failed fetch renders the same
 *     silence, because an error nobody can act on is noise.
 *   - Each suggestion opens the document in a new tab (the draft stays
 *     untouched in this one), underlined, up to three, title only.
 *   - Nothing about what was suggested or clicked is recorded anywhere.
 */

type Suggestion = { id: string; title: string }

const DEBOUNCE_MS = 400

export function TicketFieldsWithSuggestions({
  defaultTitle,
  defaultDescription,
  fieldClass,
}: {
  defaultTitle: string
  defaultDescription: string
  fieldClass: string
}) {
  const [title, setTitle] = useState(defaultTitle)
  const [description, setDescription] = useState(defaultDescription)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const timer = setTimeout(async () => {
      const draft = `${title} ${description}`.trim()
      if (draft === '') {
        setSuggestions([])
        return
      }
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      try {
        const res = await fetch('/api/help/suggestions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title, description }),
          signal: controller.signal,
        })
        if (!res.ok) return
        const data = (await res.json()) as { suggestions?: Suggestion[] }
        if (!controller.signal.aborted) {
          setSuggestions(Array.isArray(data.suggestions) ? data.suggestions : [])
        }
      } catch {
        // Silence is the contract: a fetch failure and "nothing to suggest"
        // must be indistinguishable.
      }
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [title, description])

  return (
    <>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-muted-foreground">
          What do you need help with?
        </span>
        <input
          name="title"
          type="text"
          required
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="A few words, like: the printer will not print"
          className={`${fieldClass} h-12`}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-muted-foreground">What happened?</span>
        <textarea
          name="description"
          required
          rows={6}
          maxLength={10000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What were you trying to do, and what did you see instead?"
          className={`${fieldClass} resize-y py-3 leading-relaxed`}
        />
      </label>

      {suggestions.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            These might answer your question
          </p>
          <ul className="flex flex-col gap-1.5">
            {suggestions.map((s) => (
              <li key={s.id}>
                <a
                  href={`/dashboard/help/articles/${s.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-link underline hover:text-foreground"
                >
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  )
}
