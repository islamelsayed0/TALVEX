/**
 * Tag normalization and bounds, shared by member tags (org_members.tags) and
 * article audiences (articles.audience_tags) so the two sides of the
 * targeting match can never drift apart in how they spell a tag. Free text
 * by ruling: no tag table, tags are just normalized strings that either
 * overlap or do not.
 *
 * The database bounds the array count (migration 014 check constraints);
 * per tag length and the normalization itself are enforced here, the only
 * authenticated write path.
 */

export const TAG_MAX_COUNT = 20
export const TAG_MAX_LENGTH = 40

/** Tag input failed validation; message is safe to show as form feedback. */
export class TagValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TagValidationError'
  }
}

/**
 * A free text field's worth of tags, split on commas and newlines. The tag
 * inputs post plain text; this is the one place it becomes a list.
 */
export function parseTagInput(value: string): string[] {
  return value.split(/[\n,]/)
}

/**
 * Lowercased, trimmed, inner whitespace collapsed, empties dropped,
 * duplicates removed, first spelling's order kept. Pure and total: it never
 * throws, so it can also normalize data on the way OUT of the database.
 */
export function normalizeTags(raw: string[]): string[] {
  const seen = new Set<string>()
  const tags: string[] = []
  for (const value of raw) {
    const tag = value.trim().toLowerCase().replace(/\s+/g, ' ')
    if (tag === '' || seen.has(tag)) continue
    seen.add(tag)
    tags.push(tag)
  }
  return tags
}

/**
 * Normalize and enforce the bounds, throwing form safe messages. Every
 * authenticated tag write (member tags and article audiences) goes through
 * here before the database sees it.
 */
export function validatedTags(raw: string[]): string[] {
  const tags = normalizeTags(raw)
  if (tags.length > TAG_MAX_COUNT) {
    throw new TagValidationError(`Keep it to ${TAG_MAX_COUNT} tags or fewer.`)
  }
  const tooLong = tags.find((t) => t.length > TAG_MAX_LENGTH)
  if (tooLong) {
    throw new TagValidationError(
      `Keep each tag under ${TAG_MAX_LENGTH} characters.`,
    )
  }
  return tags
}
