import type { InlineNode, MarkdownBlock } from '@/lib/articles/markdown'

/**
 * Renders a parsed legal document. Same no HTML string pipeline as the help
 * article view: the parser handed us a typed block structure and everything
 * below becomes text nodes React escapes.
 *
 * It is a separate component from MarkdownView rather than a prop on it
 * because the two are tuned for different reading jobs. The article view is
 * 14.5px inside a dashboard card. A legal document is a long read on a bare
 * page, so this one takes a wider measure, larger body text, and real air
 * around section headings.
 *
 * Unfilled placeholders render as a visible marker rather than as ordinary
 * prose. A pale [DATE] sitting inline in a paragraph is easy to skim past in
 * review, and past review is exactly where an unfilled blank must not get.
 */

/** Matches findPlaceholders in src/lib/legal/documents.ts. */
const PLACEHOLDER = /\[[A-Z0-9][A-Z0-9 /&]*\]/g

/** Split prose so placeholders can be marked, leaving other text untouched. */
function withPlaceholders(text: string, keyPrefix: string) {
  const parts: React.ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(PLACEHOLDER)) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    parts.push(
      <span
        key={`${keyPrefix}-${match.index}`}
        title="This value is not filled in yet"
        // No horizontal padding on purpose: it would open a visible gap
        // between the marker and the punctuation that follows it.
        className="rounded-[3px] bg-accent-hover-bg font-mono text-[0.88em] font-medium text-accent-text"
      >
        {match[0]}
      </span>,
    )
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts.length ? parts : text
}

function Inlines({ nodes }: { nodes: InlineNode[] }) {
  return (
    <>
      {nodes.map((node, i) => {
        switch (node.kind) {
          case 'strong':
            return (
              <strong key={i} className="font-semibold text-foreground">
                {withPlaceholders(node.text, `s${i}`)}
              </strong>
            )
          case 'em':
            return <em key={i}>{node.text}</em>
          case 'code':
            return (
              <code
                key={i}
                className="rounded bg-tile px-1.5 py-0.5 font-mono text-[0.9em]"
              >
                {node.text}
              </code>
            )
          case 'link': {
            const external = !node.href.startsWith('/')
            return (
              <a
                key={i}
                href={node.href}
                className="text-accent-text underline underline-offset-2 hover:text-foreground"
                {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
              >
                {node.text}
              </a>
            )
          }
          default:
            return (
              <span key={i}>{withPlaceholders(node.text, `t${i}`)}</span>
            )
        }
      })}
    </>
  )
}

export function DocumentBody({ blocks }: { blocks: MarkdownBlock[] }) {
  return (
    <div className="flex flex-col text-[15.5px] leading-[1.75] text-secondary-foreground">
      {blocks.map((block, i) => {
        switch (block.kind) {
          case 'heading': {
            const H = `h${block.level}` as 'h2' | 'h3' | 'h4'
            const size =
              block.level === 2
                ? 'text-[21px] mt-11'
                : block.level === 3
                  ? 'text-[17px] mt-8'
                  : 'text-[15.5px] mt-6'
            return (
              <H
                key={i}
                className={`${size} mb-3 font-display font-semibold tracking-[-0.015em] text-foreground first:mt-0`}
              >
                <Inlines nodes={block.inlines} />
              </H>
            )
          }
          case 'list':
            return block.ordered ? (
              <ol
                key={i}
                className="my-2 ml-6 flex list-decimal flex-col gap-2 marker:text-quiet"
              >
                {block.items.map((item, j) => (
                  <li key={j} className="pl-1">
                    <Inlines nodes={item} />
                  </li>
                ))}
              </ol>
            ) : (
              <ul
                key={i}
                className="my-2 ml-6 flex list-disc flex-col gap-2 marker:text-quiet"
              >
                {block.items.map((item, j) => (
                  <li key={j} className="pl-1">
                    <Inlines nodes={item} />
                  </li>
                ))}
              </ul>
            )
          case 'blockquote':
            // Both drafted documents open with the attorney review notice as a
            // blockquote. It is the most consequential sentence on the page, so
            // it renders as a callout rather than as indented body text.
            return (
              <div
                key={i}
                className="my-5 rounded-card border border-card-border bg-card px-5 py-4 text-[14.5px] leading-[1.7] text-muted-foreground"
              >
                <Inlines nodes={block.inlines} />
              </div>
            )
          case 'codeblock':
            return (
              <pre
                key={i}
                className="my-4 overflow-x-auto rounded-nested bg-tile p-4 font-mono text-[13px] leading-relaxed"
              >
                {block.text}
              </pre>
            )
          default:
            return (
              <p key={i} className="mt-4 first:mt-0">
                <Inlines nodes={block.inlines} />
              </p>
            )
        }
      })}
    </div>
  )
}

/**
 * The page frame every legal document shares: h1, optional effective date
 * line, then the body at a comfortable reading measure.
 */
export function DocumentPage({
  title,
  effective,
  blocks,
}: {
  title: string
  effective?: string
  blocks: MarkdownBlock[]
}) {
  return (
    <article className="mx-auto w-full max-w-[46rem] px-6 pt-16 pb-24">
      <h1 className="font-display text-[clamp(30px,5vw,42px)] font-semibold leading-[1.1] tracking-[-0.028em] text-foreground">
        {title}
      </h1>
      {effective ? (
        <p className="mt-3 text-[13.5px] text-quiet">{effective}</p>
      ) : null}
      <div className="mt-10">
        <DocumentBody blocks={blocks} />
      </div>
    </article>
  )
}
