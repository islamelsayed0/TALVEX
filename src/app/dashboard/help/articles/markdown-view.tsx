import type { InlineNode, MarkdownBlock } from '@/lib/articles/markdown'

/**
 * Renders parsed article markdown as React elements. There is no HTML
 * string anywhere in this pipeline: the parser (src/lib/articles/markdown)
 * produced a typed structure, and everything below becomes text nodes that
 * React escapes. Links open in the same tab when they point inside the app
 * and in a new one when they leave it.
 */

function Inlines({ nodes }: { nodes: InlineNode[] }) {
  return (
    <>
      {nodes.map((node, i) => {
        switch (node.kind) {
          case 'strong':
            return (
              <strong key={i} className="font-semibold text-foreground">
                {node.text}
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
                className="text-accent-text hover:underline"
                {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
              >
                {node.text}
              </a>
            )
          }
          default:
            return <span key={i}>{node.text}</span>
        }
      })}
    </>
  )
}

export function MarkdownView({ blocks }: { blocks: MarkdownBlock[] }) {
  return (
    <div className="flex flex-col gap-4 text-[14.5px] leading-relaxed text-muted-foreground">
      {blocks.map((block, i) => {
        switch (block.kind) {
          case 'heading': {
            const H = (`h${block.level}`) as 'h2' | 'h3' | 'h4'
            const size =
              block.level === 2
                ? 'text-[19px] mt-2'
                : block.level === 3
                  ? 'text-[16.5px] mt-1'
                  : 'text-[15px]'
            return (
              <H
                key={i}
                className={`${size} font-semibold tracking-[-0.01em] text-foreground`}
              >
                <Inlines nodes={block.inlines} />
              </H>
            )
          }
          case 'list':
            return block.ordered ? (
              <ol key={i} className="ml-5 flex list-decimal flex-col gap-1.5">
                {block.items.map((item, j) => (
                  <li key={j}>
                    <Inlines nodes={item} />
                  </li>
                ))}
              </ol>
            ) : (
              <ul key={i} className="ml-5 flex list-disc flex-col gap-1.5">
                {block.items.map((item, j) => (
                  <li key={j}>
                    <Inlines nodes={item} />
                  </li>
                ))}
              </ul>
            )
          case 'codeblock':
            return (
              <pre
                key={i}
                className="overflow-x-auto rounded-nested bg-tile p-4 font-mono text-[12.5px] leading-relaxed"
              >
                {block.text}
              </pre>
            )
          default:
            return (
              <p key={i}>
                <Inlines nodes={block.inlines} />
              </p>
            )
        }
      })}
    </div>
  )
}
