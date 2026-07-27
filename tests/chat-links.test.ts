import { describe, expect, it } from 'vitest'

import { fullChatHref, toProviderOptions } from '../src/app/dashboard/chat/ui'

describe('fullChatHref', () => {
  it('deep links to a conversation once one exists', () => {
    expect(fullChatHref('abc123')).toBe('/dashboard/chat/abc123')
  })

  it('falls back to the chat home before any conversation', () => {
    expect(fullChatHref(null)).toBe('/dashboard/chat')
  })
})

describe('toProviderOptions', () => {
  it('labels each configured provider, preserving order', () => {
    const options = toProviderOptions(['anthropic', 'openai'])
    expect(options.map((o) => o.value)).toEqual(['anthropic', 'openai'])
    expect(options.every((o) => typeof o.label === 'string' && o.label.length > 0)).toBe(true)
  })

  it('is empty when the org has no keys', () => {
    expect(toProviderOptions([])).toEqual([])
  })
})
