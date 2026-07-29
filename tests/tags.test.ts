import { describe, expect, it } from 'vitest'

import {
  normalizeTags,
  parseTagInput,
  TAG_MAX_COUNT,
  TAG_MAX_LENGTH,
  TagValidationError,
  validatedTags,
} from '@/lib/db/tags'

// Tag normalization and bounds (F14 ruling 3): free text, lowercased and
// trimmed, bounded in count and length. Both sides of the audience match
// (member tags and article audiences) go through these exact functions, so
// what is proven here holds for the whole targeting model.

describe('parseTagInput', () => {
  it('splits on commas and newlines', () => {
    expect(parseTagInput('onsite, printers\nfinance')).toEqual([
      'onsite',
      ' printers',
      'finance',
    ])
  })

  it('yields nothing meaningful for empty input once normalized', () => {
    expect(normalizeTags(parseTagInput(''))).toEqual([])
    expect(normalizeTags(parseTagInput('  ,, \n , '))).toEqual([])
  })
})

describe('normalizeTags', () => {
  it('lowercases, trims, and collapses inner whitespace', () => {
    expect(normalizeTags(['  OnSite ', 'HELP  DESK'])).toEqual([
      'onsite',
      'help desk',
    ])
  })

  it('drops empties and deduplicates after normalization, keeping first order', () => {
    expect(normalizeTags(['b', '', ' B ', 'a', 'b'])).toEqual(['b', 'a'])
  })

  it('never throws: it also normalizes data on the way out of the database', () => {
    expect(normalizeTags([])).toEqual([])
    expect(normalizeTags(['x'.repeat(500)])).toEqual(['x'.repeat(500)])
  })
})

describe('validatedTags', () => {
  it('returns the normalized list when within bounds', () => {
    expect(validatedTags([' Onsite ', 'onsite', 'finance'])).toEqual([
      'onsite',
      'finance',
    ])
  })

  it(`refuses more than ${TAG_MAX_COUNT} tags`, () => {
    const many = Array.from({ length: TAG_MAX_COUNT + 1 }, (_, i) => `tag${i}`)
    expect(() => validatedTags(many)).toThrow(TagValidationError)
  })

  it(`accepts exactly ${TAG_MAX_COUNT} tags, the boundary`, () => {
    const exact = Array.from({ length: TAG_MAX_COUNT }, (_, i) => `tag${i}`)
    expect(validatedTags(exact)).toHaveLength(TAG_MAX_COUNT)
  })

  it(`refuses a tag longer than ${TAG_MAX_LENGTH} characters`, () => {
    expect(() => validatedTags(['x'.repeat(TAG_MAX_LENGTH + 1)])).toThrow(
      TagValidationError,
    )
    expect(validatedTags(['x'.repeat(TAG_MAX_LENGTH)])).toEqual([
      'x'.repeat(TAG_MAX_LENGTH),
    ])
  })

  it('counts duplicates once, so repeated spellings cannot burst the bound', () => {
    const spellings = Array.from({ length: TAG_MAX_COUNT * 2 }, (_, i) =>
      i % 2 === 0 ? 'same' : ' SAME ',
    )
    expect(validatedTags(spellings)).toEqual(['same'])
  })
})
