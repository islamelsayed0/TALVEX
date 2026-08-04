import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

/**
 * docs/RUNBOOK.md is the operator's document, and two of its statements are
 * load bearing in a way prose usually is not. Both are the kind of caveat that
 * gets tidied away in a later edit, and both would leave someone believing in
 * coverage that does not exist:
 *
 *   1. Self monitoring cannot detect a dead sweep. Talvext's own monitors are
 *      checked by that same sweep, so when it dies the status page freezes on
 *      green. Anyone who forgets this thinks S5 replaced the external watcher.
 *   2. Point in time recovery is not enabled and cannot be on the free plan.
 *      S6 is partly unmet, and a BRD close out that marks it green would be
 *      claiming a recovery capability that does not exist.
 *
 * Asserting prose is unusual, and it is the same shape as the guards this repo
 * already keeps over .gitignore, .env.example, and the workflow YAML.
 */

const runbook = readFileSync('docs/RUNBOOK.md', 'utf8')

describe('the runbook keeps its load bearing caveats', () => {
  it('says plainly that self monitoring cannot detect a dead sweep', () => {
    expect(runbook).toMatch(/self monitoring cannot detect a dead sweep/i)
  })

  it('distinguishes what each watching layer catches from what it does not', () => {
    expect(runbook).toMatch(/Does not catch/i)
  })

  it('states that point in time recovery is not met and needs money', () => {
    expect(runbook).toMatch(/point in time recovery/i)
    expect(runbook).toMatch(/free.{0,20}plan/i)
    expect(runbook).toMatch(/partly met|not met|cannot be met/i)
  })

  it('warns that a dump holds every tenant row', () => {
    expect(runbook).toMatch(/every tenant row/i)
  })

  it('records the two environment traps that have cost real debugging time', () => {
    expect(runbook).toMatch(/inlined at build time/i)
    expect(runbook).toMatch(/environment snapshot/i)
  })

  it('names the operational variables it owns', () => {
    for (const name of ['CRON_SECRET', 'OPS_DISCORD_WEBHOOK']) {
      expect(runbook).toContain(name)
    }
  })
})

describe('the dump destination cannot be committed', () => {
  const gitignore = readFileSync('.gitignore', 'utf8')

  it('ignores the backups directory the dump script writes to', () => {
    // A dump is a complete copy of every tenant row. The one mistake that
    // would matter most here is committing one.
    expect(gitignore).toMatch(/^\/backups$/m)
  })

  it('the dump script writes where the ignore rule covers', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>
    }
    expect(pkg.scripts['db:dump']).toBeDefined()
    expect(pkg.scripts['db:dump']).toContain('backups/')
  })
})
