import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import nextConfig from '../next.config'

// The Get help feature moved from /dashboard/get-help to /dashboard/help.
// Two things have to stay true for that move to hold: the old path keeps
// redirecting to the new one, and no source still points at the old path.
// This suite guards both, since either could silently rot in a later PR.

describe('help route redirect', () => {
  it('permanently redirects the old get-help path to help, subpaths included', async () => {
    const rules = (await nextConfig.redirects?.()) ?? []
    const rule = rules.find((r) => r.source.startsWith('/dashboard/get-help'))

    expect(rule).toBeDefined()
    expect(rule).toMatchObject({
      source: '/dashboard/get-help/:path*',
      destination: '/dashboard/help/:path*',
      permanent: true,
    })
  })
})

describe('help route rename is complete', () => {
  const srcDir = path.resolve(__dirname, '../src')

  function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name)
      return entry.isDirectory() ? walk(full) : [full]
    })
  }

  it('leaves no reference to the old get-help route anywhere in src', () => {
    const offenders = walk(srcDir).filter((file) =>
      readFileSync(file, 'utf8').includes('dashboard/get-help'),
    )
    expect(offenders).toEqual([])
  })
})
