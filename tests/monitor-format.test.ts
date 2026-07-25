import { describe, expect, it } from 'vitest'

import { formatInterval } from '../src/app/dashboard/monitors/ui'

describe('formatInterval', () => {
  it('says minutes below an hour', () => {
    expect(formatInterval(300)).toBe('every 5 min')
    expect(formatInterval(600)).toBe('every 10 min')
    expect(formatInterval(1800)).toBe('every 30 min')
  })
  it('says hours on the hour, singular and plural', () => {
    expect(formatInterval(3600)).toBe('every 1 hour')
    expect(formatInterval(7200)).toBe('every 2 hours')
  })
})
