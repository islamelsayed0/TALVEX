'use client'

import { useState } from 'react'

/** The live status page URL with a copy button. Client only for the clipboard. */
export function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <div className="flex items-center gap-2">
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="min-w-0 flex-1 truncate rounded-field border border-input bg-field px-3.5 py-2.5 font-mono text-[12.5px] text-accent-text"
      >
        {url}
      </a>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(url)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
        className="flex-none rounded-button border border-(--ghost-border) px-3.5 py-2.5 text-[13px] font-semibold text-ghost-text transition-colors hover:border-(--ghost-border-hover)"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}
