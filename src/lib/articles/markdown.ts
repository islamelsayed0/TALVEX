/**
 * Markdown for help articles: a deliberately small parser producing a typed
 * block structure that the article page renders as React elements. There is
 * no HTML string anywhere in the pipeline and no dangerouslySetInnerHTML in
 * the repo, so markup injection is structurally impossible: whatever
 * survives parsing becomes text nodes, which React escapes.
 *
 * Sanitization (ruling 5, no raw HTML passthrough ever) still strips HTML
 * tags out of prose rather than printing them back at the reader: an author
 * pasting `<script>` or an inline event handler gets their words kept and
 * their markup dropped. Code blocks and inline code are exempt from
 * stripping because their content is displayed as literal text by
 * definition, which React renders inert.
 *
 * Supported, matching what help articles actually need: headings, paragraphs,
 * bulleted and numbered lists, bold, italics, inline code, fenced code
 * blocks, and links restricted to safe destinations. Everything else is
 * plain text. No images by ruling (non goals), so image syntax renders as
 * its alt text link form, harmless.
 */

export type InlineNode =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'em'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string }

export type MarkdownBlock =
  | { kind: 'heading'; level: 2 | 3 | 4; inlines: InlineNode[] }
  | { kind: 'paragraph'; inlines: InlineNode[] }
  | { kind: 'list'; ordered: boolean; items: InlineNode[][] }
  | { kind: 'codeblock'; text: string }

/** HTML tags (with any attributes and event handlers) removed from prose.
 * The words around and inside a tag survive; the markup does not. */
export function stripHtml(text: string): string {
  return text.replace(/<\/?[a-zA-Z][^>]*>/g, '')
}

/** Only destinations that cannot execute anything: web URLs, mail, and in
 * app paths. Anything else (javascript:, data:, vbscript:, unknown schemes)
 * is refused and the link renders as its text. */
export function isSafeHref(href: string): boolean {
  const value = href.trim().toLowerCase()
  return (
    value.startsWith('https://') ||
    value.startsWith('http://') ||
    value.startsWith('mailto:') ||
    (value.startsWith('/') && !value.startsWith('//'))
  )
}

/** Inline markdown over already stripped prose: links, bold, italics, code. */
export function parseInlines(text: string): InlineNode[] {
  const nodes: InlineNode[] = []
  // One token at a time, longest constructs first so ** beats *.
  const pattern =
    /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`/g
  let last = 0
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) {
      nodes.push({ kind: 'text', text: text.slice(last, match.index) })
    }
    const [, linkText, href, strong, em, code] = match
    if (linkText !== undefined && href !== undefined) {
      if (isSafeHref(href)) {
        nodes.push({ kind: 'link', text: linkText, href })
      } else {
        nodes.push({ kind: 'text', text: linkText })
      }
    } else if (strong !== undefined) {
      nodes.push({ kind: 'strong', text: strong })
    } else if (em !== undefined) {
      nodes.push({ kind: 'em', text: em })
    } else if (code !== undefined) {
      nodes.push({ kind: 'code', text: code })
    }
    last = match.index + match[0].length
  }
  if (last < text.length) {
    nodes.push({ kind: 'text', text: text.slice(last) })
  }
  return nodes
}

const HEADING = /^(#{1,6})\s+(.*)$/
const BULLET = /^[-*]\s+(.*)$/
const NUMBERED = /^\d+[.)]\s+(.*)$/
const FENCE = /^```/

/** The whole document, top to bottom, one pass. */
export function parseMarkdown(source: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = []
  const lines = source.replaceAll('\r\n', '\n').split('\n')
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (line.trim() === '') {
      i += 1
      continue
    }

    if (FENCE.test(line)) {
      const code: string[] = []
      i += 1
      while (i < lines.length && !FENCE.test(lines[i])) {
        code.push(lines[i])
        i += 1
      }
      i += 1 // closing fence, or end of input
      blocks.push({ kind: 'codeblock', text: code.join('\n') })
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      // The article title is the page's h1, so # starts at h2.
      const level = Math.min(heading[1].length + 1, 4) as 2 | 3 | 4
      blocks.push({
        kind: 'heading',
        level,
        inlines: parseInlines(stripHtml(heading[2])),
      })
      i += 1
      continue
    }

    if (BULLET.test(line) || NUMBERED.test(line)) {
      const ordered = NUMBERED.test(line)
      const marker = ordered ? NUMBERED : BULLET
      const items: InlineNode[][] = []
      while (i < lines.length) {
        const item = marker.exec(lines[i])
        if (!item) break
        items.push(parseInlines(stripHtml(item[1])))
        i += 1
      }
      blocks.push({ kind: 'list', ordered, items })
      continue
    }

    // Paragraph: consecutive plain lines joined with spaces.
    const para: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !FENCE.test(lines[i]) &&
      !HEADING.test(lines[i]) &&
      !BULLET.test(lines[i]) &&
      !NUMBERED.test(lines[i])
    ) {
      para.push(lines[i].trim())
      i += 1
    }
    blocks.push({
      kind: 'paragraph',
      inlines: parseInlines(stripHtml(para.join(' '))),
    })
  }

  return blocks
}

/** Every human readable word in the parsed document, for tests and for a
 * plain text excerpt on list rows. */
export function markdownPlainText(blocks: MarkdownBlock[]): string {
  const inlineText = (inlines: InlineNode[]) =>
    inlines.map((n) => n.text).join('')
  return blocks
    .map((block) => {
      switch (block.kind) {
        case 'heading':
        case 'paragraph':
          return inlineText(block.inlines)
        case 'list':
          return block.items.map(inlineText).join(' ')
        case 'codeblock':
          return block.text
      }
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}
