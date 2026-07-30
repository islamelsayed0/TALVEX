import { accessSync, constants, readFileSync, statSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

/**
 * The pre commit secret scan (BRD S2's missing half).
 *
 * A hook is easy to add and just as easy to render inert: a missing execute
 * bit, a renamed script, or an `exit 0` when the scanner is absent all leave a
 * file that looks like protection and provides none. These assertions are
 * cheap and catch every one of those.
 *
 * The fail closed case is the important one. This repository already ruled,
 * when arming the migration drift guard, that a guard which quietly stops
 * guarding is worse than no guard, because it produces confidence without
 * cover. A hook that passes when gitleaks is not installed is precisely that.
 */

const HOOK = '.githooks/pre-commit'
const hook = readFileSync(HOOK, 'utf8')

describe('the pre commit hook', () => {
  it('is executable, or git silently ignores it', () => {
    expect(() => accessSync(HOOK, constants.X_OK)).not.toThrow()
    expect(statSync(HOOK).mode % 0o1000).toBeGreaterThanOrEqual(0o700)
  })

  it('scans the staged changes rather than the working tree or the history', () => {
    expect(hook).toContain('gitleaks git --staged')
  })

  it('does not use the retired protect spelling', () => {
    // `gitleaks protect` still runs in 8.30.1 but is gone from the tool's
    // list of available commands. Pinning this stops it drifting back in.
    //
    // Only the executable lines are checked. The comments above deliberately
    // name the old spelling to explain why it was left behind, and a test
    // that read those would be asserting prose rather than behaviour.
    const commands = hook
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n')
    expect(commands).not.toMatch(/gitleaks\s+protect/)
  })

  it('redacts findings, so a secret is not printed into terminal scrollback', () => {
    expect(hook).toContain('--redact')
  })

  it('fails closed when gitleaks is not installed', () => {
    // The whole point: no `exit 0` on the missing binary path.
    expect(hook).toMatch(/command -v gitleaks/)
    expect(hook).toMatch(/exit 1/)
    expect(hook).not.toMatch(/gitleaks[\s\S]*?then[\s\S]*?exit 0/)
  })

  it('tells the reader how to install it and how to skip deliberately', () => {
    expect(hook).toContain('brew install gitleaks')
    expect(hook).toContain('--no-verify')
  })
})

describe('the hook installs itself', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
    scripts: Record<string, string>
  }

  it('points git at the tracked hooks directory on install', () => {
    // Without this the file is inert on every fresh clone, which is the most
    // likely way this protection quietly stops existing.
    expect(pkg.scripts.prepare).toBe('git config core.hooksPath .githooks')
  })
})

describe('CI remains the boundary', () => {
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8')

  it('still runs a secret scan that a local --no-verify cannot bypass', () => {
    expect(ci).toMatch(/gitleaks/i)
  })
})
