import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { errorName, logError, logInfo, type LogDetail } from '@/lib/log'

/**
 * src/lib/log.ts is the only module in the codebase permitted to touch the
 * console, so these are the tests that make the guarantees it advertises real:
 * one line of JSON, a fixed field set, and no path by which an object (and
 * therefore a stack, a request body, or a database row) reaches the output.
 *
 * The last group matters most. TypeScript already refuses a non primitive in
 * LogDetail, but a compile time refusal is not a guarantee at runtime: this
 * module is imported by route handlers where a value can arrive from JSON.
 * So the runtime guard is tested through a deliberately unchecked cast, which
 * is exactly the shape a careless caller would produce.
 */

let out: { log: string[]; error: string[] }
let logSpy: ReturnType<typeof vi.spyOn>
let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  out = { log: [], error: [] }
  logSpy = vi.spyOn(console, 'log').mockImplementation((text: unknown) => {
    out.log.push(String(text))
  })
  errorSpy = vi.spyOn(console, 'error').mockImplementation((text: unknown) => {
    out.error.push(String(text))
  })
})

afterEach(() => {
  logSpy.mockRestore()
  errorSpy.mockRestore()
})

/** The single line each helper wrote, already parsed. */
function parsedLog(): Record<string, unknown> {
  expect(out.log).toHaveLength(1)
  return JSON.parse(out.log[0]) as Record<string, unknown>
}
function parsedError(): Record<string, unknown> {
  expect(out.error).toHaveLength(1)
  return JSON.parse(out.error[0]) as Record<string, unknown>
}

describe('every line is one parseable JSON object', () => {
  it('logInfo writes a single line to console.log and nothing to console.error', () => {
    logInfo('cron.sweep.complete', 'ok', { due: 3 })
    expect(out.error).toHaveLength(0)
    expect(out.log[0]).not.toContain('\n')
    expect(() => JSON.parse(out.log[0])).not.toThrow()
  })

  it('logError writes a single line to console.error and nothing to console.log', () => {
    logError('cron.monitors.list_failed', 'failed', { error: 'connection refused' })
    expect(out.log).toHaveLength(0)
    expect(out.error[0]).not.toContain('\n')
    expect(() => JSON.parse(out.error[0])).not.toThrow()
  })
})

describe('the field set is exactly the declared one', () => {
  it('carries ts, level, event, outcome and detail, and nothing else', () => {
    logInfo('clerk.webhook.applied', 'ok', { event_type: 'organization.created' })
    expect(Object.keys(parsedLog()).sort()).toEqual([
      'detail',
      'event',
      'level',
      'outcome',
      'ts',
    ])
  })

  it('omits detail entirely when the caller passes none', () => {
    logError('notifications.dispatch.email_failed', 'failed')
    expect(Object.keys(parsedError()).sort()).toEqual(['event', 'level', 'outcome', 'ts'])
  })

  it('omits detail when the caller passes an empty object', () => {
    logInfo('cron.sweep.complete', 'ok', {})
    expect(parsedLog()).not.toHaveProperty('detail')
  })

  it('records the event name and outcome verbatim', () => {
    logError('cron.digest.send_failed', 'rejected', { reason: 'Resend rejected it.' })
    const line = parsedError()
    expect(line.event).toBe('cron.digest.send_failed')
    expect(line.outcome).toBe('rejected')
    expect(line.level).toBe('error')
    expect(line.detail).toEqual({ reason: 'Resend rejected it.' })
  })

  it('stamps a parseable ISO timestamp', () => {
    logInfo('cron.sweep.complete', 'ok')
    const ts = parsedLog().ts
    expect(typeof ts).toBe('string')
    expect(Number.isNaN(Date.parse(ts as string))).toBe(false)
  })
})

describe('no object can reach the output', () => {
  it('replaces a non primitive with a marker rather than serializing it', () => {
    // The cast is the point: this is what an unchecked caller looks like.
    const careless = { nested: { secret: 'value' } } as unknown as LogDetail
    logInfo('cron.sweep.complete', 'ok', careless)
    const line = parsedLog()
    expect(line.detail).toEqual({ nested: '[unloggable]' })
    expect(out.log[0]).not.toContain('secret')
    expect(out.log[0]).not.toContain('value')
  })

  it('an Error passed as a detail value never contributes a message or a stack', () => {
    const err = new Error('a message that quotes a row')
    const careless = { error: err } as unknown as LogDetail
    logError('cron.digest.org_failed', 'failed', careless)
    expect(out.error[0]).not.toContain('a message that quotes a row')
    expect(out.error[0]).not.toContain('at ')
    expect(parsedError().detail).toEqual({ error: '[unloggable]' })
  })

  it('keeps strings, numbers and booleans intact', () => {
    logInfo('chat.provider.call', 'ok', {
      provider: 'anthropic',
      status: 200,
      latency_ms: 412,
      cached: false,
    })
    expect(parsedLog().detail).toEqual({
      provider: 'anthropic',
      status: 200,
      latency_ms: 412,
      cached: false,
    })
  })
})

describe('errorName', () => {
  it('returns the class name of an Error, never its message', () => {
    expect(errorName(new TypeError('boom, with detail'))).toBe('TypeError')
  })

  it('returns a fixed token for anything that is not an Error', () => {
    expect(errorName('a bare string')).toBe('unknown')
    expect(errorName(null)).toBe('unknown')
    expect(errorName({ message: 'shaped like an error' })).toBe('unknown')
  })
})
