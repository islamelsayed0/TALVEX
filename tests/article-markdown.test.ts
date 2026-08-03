import { describe, expect, it } from 'vitest'

import {
  isSafeHref,
  markdownPlainText,
  parseInlines,
  parseMarkdown,
  stripHtml,
} from '@/lib/articles/markdown'

// Article markdown (F14 ruling 5): rendered sanitized server side, no raw
// HTML passthrough ever. The renderer emits React elements from the typed
// blocks proven here, so what these tests establish is that nothing
// executable survives parsing: HTML tags are stripped from prose, and link
// destinations that could run code are refused.

describe('stripHtml', () => {
  it('strips script tags and keeps the surrounding words', () => {
    expect(stripHtml('before <script>alert(1)</script> after')).toBe(
      'before alert(1) after',
    )
  })

  it('strips tags carrying event handlers', () => {
    expect(stripHtml('<img src=x onerror="alert(1)"> hi')).toBe(' hi')
    expect(stripHtml('<div onclick="steal()">content</div>')).toBe('content')
  })

  it('strips closing tags, attributes, and uppercase variants', () => {
    expect(stripHtml('<SCRIPT SRC="//evil">x</SCRIPT>')).toBe('x')
    expect(stripHtml('<iframe src="https://evil.example"></iframe>')).toBe('')
  })

  it('leaves plain prose and comparisons alone', () => {
    expect(stripHtml('use a < b and c > d in math')).toBe(
      'use a < b and c > d in math',
    )
  })
})

describe('isSafeHref', () => {
  it('allows web, mail, and in app destinations', () => {
    expect(isSafeHref('https://example.com')).toBe(true)
    expect(isSafeHref('http://example.com')).toBe(true)
    expect(isSafeHref('mailto:it@example.com')).toBe(true)
    expect(isSafeHref('/dashboard/help')).toBe(true)
  })

  it('refuses anything that could execute or escape', () => {
    expect(isSafeHref('javascript:alert(1)')).toBe(false)
    expect(isSafeHref('JavaScript:alert(1)')).toBe(false)
    expect(isSafeHref(' javascript:alert(1)')).toBe(false)
    expect(isSafeHref('data:text/html,<script>1</script>')).toBe(false)
    expect(isSafeHref('vbscript:x')).toBe(false)
    expect(isSafeHref('//protocol-relative.example')).toBe(false)
  })
})

describe('parseInlines', () => {
  it('parses bold, italics, code, and links', () => {
    expect(parseInlines('a **b** *c* `d` [e](https://x.example)')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'strong', text: 'b' },
      { kind: 'text', text: ' ' },
      { kind: 'em', text: 'c' },
      { kind: 'text', text: ' ' },
      { kind: 'code', text: 'd' },
      { kind: 'text', text: ' ' },
      { kind: 'link', text: 'e', href: 'https://x.example' },
    ])
  })

  it('renders an unsafe link as its text alone, no destination', () => {
    expect(parseInlines('[click me](javascript:alert%281%29)')).toEqual([
      { kind: 'text', text: 'click me' },
    ])
  })
})

describe('parseMarkdown', () => {
  it('parses headings, paragraphs, lists, and code fences', () => {
    const blocks = parseMarkdown(
      '# Title\n\nA paragraph\nof two lines.\n\n- one\n- two\n\n1. first\n2. second\n\n```\ncode here\n```',
    )
    expect(blocks.map((b) => b.kind)).toEqual([
      'heading',
      'paragraph',
      'list',
      'list',
      'codeblock',
    ])
    const [heading, , bullets, numbered, code] = blocks
    expect(heading).toMatchObject({ level: 2 })
    expect(bullets).toMatchObject({ ordered: false })
    expect(numbered).toMatchObject({ ordered: true })
    expect(code).toMatchObject({ text: 'code here' })
  })

  it('demotes deep headings to h4 at most (the article title owns h1)', () => {
    const blocks = parseMarkdown('### Deep\n\n###### Deeper')
    expect(blocks).toMatchObject([{ level: 4 }, { level: 4 }])
  })

  it('a whole document of hostile HTML parses to text only blocks', () => {
    const blocks = parseMarkdown(
      '<script>alert(1)</script>\n\n## Safe <b onclick="x()">heading</b>\n\n- <img src=x onerror=steal()>item',
    )
    const text = markdownPlainText(blocks)
    expect(text).not.toContain('<')
    expect(text).not.toContain('onerror')
    expect(text).not.toContain('onclick')
    expect(text).toContain('Safe heading')
    expect(text).toContain('item')
  })

  it('keeps code block content literal (React renders it inert as text)', () => {
    const blocks = parseMarkdown('```\n<script>example()</script>\n```')
    expect(blocks).toEqual([
      { kind: 'codeblock', text: '<script>example()</script>' },
    ])
  })

  it('an unclosed fence swallows to the end instead of leaking lines', () => {
    const blocks = parseMarkdown('```\nline one\nline two')
    expect(blocks).toEqual([{ kind: 'codeblock', text: 'line one\nline two' }])
  })

  // Blockquotes arrived with the legal pages, whose drafted documents open
  // with the attorney review notice as one.
  it('parses a blockquote, with the marker stripped', () => {
    expect(parseMarkdown('> **Notice.** Read this.')).toEqual([
      {
        kind: 'blockquote',
        inlines: [
          { kind: 'strong', text: 'Notice.' },
          { kind: 'text', text: ' Read this.' },
        ],
      },
    ])
  })

  it('joins consecutive quoted lines into one blockquote', () => {
    const blocks = parseMarkdown('> one\n> two\n\nafter')
    expect(blocks).toEqual([
      { kind: 'blockquote', inlines: [{ kind: 'text', text: 'one two' }] },
      { kind: 'paragraph', inlines: [{ kind: 'text', text: 'after' }] },
    ])
  })

  it('does not let a quote bleed into the paragraph above it', () => {
    const blocks = parseMarkdown('lead in\n> quoted')
    expect(blocks).toEqual([
      { kind: 'paragraph', inlines: [{ kind: 'text', text: 'lead in' }] },
      { kind: 'blockquote', inlines: [{ kind: 'text', text: 'quoted' }] },
    ])
  })

  it('strips HTML inside a quote like anywhere else', () => {
    const blocks = parseMarkdown('> <script>alert(1)</script>keep me')
    expect(blocks).toEqual([
      { kind: 'blockquote', inlines: [{ kind: 'text', text: 'alert(1)keep me' }] },
    ])
  })
})
