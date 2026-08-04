import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

/**
 * The truth sweep: the gate on the 2026-08-03 rename to Talvext.
 *
 * The product was renamed (Telvix, then Talvex, then Talvext; the decision
 * entry records why Talvext is the last). This test fails if an old name
 * appears anywhere a user or reader can see: UI strings, the landing copy
 * module, the email and Discord builders, the rendered legal sources, and
 * every living document. It asserts the substance, the old name absent from
 * what people see, not a marker left behind by the rename.
 *
 * What it deliberately does not police: lowercase and uppercase identifiers
 * that are config shaped rather than branding. Env var names (TALVEX_SLUG,
 * TALVEX_TEST_*), the Supabase project id, the talvex-chi.vercel.app
 * deployment URLs, the org status page slug, and on disk paths all keep their
 * spelling; the title case matcher below never touches them. The receiving
 * surfaces in RECEIVED_SURFACES get the strict any case check instead,
 * because nothing config shaped lives in what users are sent or shown.
 */

/** Matches Talvex (not Talvext), and the two abandoned or adjacent names. */
const TITLE_CASE_OLD_NAME = /Talvex(?!t)|Telvix|Talvix/g
/** The strict form for received surfaces: any casing of any old name. */
const ANY_CASE_OLD_NAME = /talvex(?!t)|telvix|talvix/gi

/**
 * Surfaces a user is directly sent or shown, checked in any casing: the
 * landing copy module, the notification builders, the AI assistant's identity,
 * sign in copy, and the sources the legal pages render verbatim.
 */
const RECEIVED_SURFACES = [
  'src/app/_landing/copy.ts',
  'src/lib/notifications/email.ts',
  'src/lib/notifications/discord.ts',
  'src/lib/notifications/digest.ts',
  'src/lib/chat/system-prompt.ts',
  'src/lib/theme/clerk-localization.ts',
  'src/app/(legal)/_content/terms.ts',
  'src/app/(legal)/_content/privacy.ts',
  'src/app/(legal)/_content/accessibility.ts',
]

/**
 * Historical records and the files that legitimately name them. Each entry
 * carries its reason; an entry whose file no longer contains an old name is
 * reported so the allowlist cannot rot.
 */
const ALLOWLIST: ReadonlyArray<{ path: string; reason: string }> = [
  { path: 'docs/BRD.md', reason: 'the founding record; keeps the original name, with a preface line noting the rename' },
  { path: 'docs/DECISIONS.md', reason: 'dated entries are records, and the rename entry itself names the old names' },
  { path: 'docs/DEPLOY_LOG.md', reason: 'a dated record of the Phase 0 production deploy' },
  { path: 'docs/PHASE_0_PLAN.md', reason: 'the Phase 0 plan, a historical document finished before the rename' },
  { path: 'docs/RUNBOOK.md', reason: 'names the real Clerk application object, which is still called Talvex in that dashboard, and cites the rename decision' },
  { path: 'docs/design/DESIGN.md', reason: 'references the on disk Talvex Landing design artifact by its real name' },
  { path: 'docs/design/README.md', reason: 'references on disk design artifact filenames (Talvex *.dc.html) that keep their names' },
  { path: 'docs/design/handoff/README.md', reason: 'references on disk design artifact filenames (Talvex *.dc.html) that keep their names' },
  { path: 'docs/design/sign-in-explorations.html', reason: 'a dated design exploration artifact from before the rename' },
  { path: 'docs/design/sign-in-final.html', reason: 'a dated design artifact of the sign in as first shipped' },
]

const SCANNED_EXTENSIONS = /\.(md|ts|tsx|mjs|js|css|html|toml|yml|yaml)$/

/** The hunter must name its prey: this file spells out the old names in its
 * patterns, comments, and allowlist reasons, so it is the one file the scan
 * skips by construction rather than by allowlist. */
const SELF = 'tests/truth-sweep.test.ts'

function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files'], { encoding: 'utf8' })
    .split('\n')
    .filter((f) => SCANNED_EXTENSIONS.test(f) && f !== SELF)
}

function hits(file: string, pattern: RegExp): string[] {
  const source = readFileSync(file, 'utf8')
  const found: string[] = []
  for (const [index, line] of source.split('\n').entries()) {
    pattern.lastIndex = 0
    if (pattern.test(line)) found.push(`${file}:${index + 1}: ${line.trim().slice(0, 100)}`)
  }
  return found
}

describe('no old product name survives anywhere user facing', () => {
  it('keeps every surface a user is sent or shown free of any casing of an old name', () => {
    const offending = RECEIVED_SURFACES.flatMap((f) => hits(f, ANY_CASE_OLD_NAME))
    expect(offending, 'these lines reach users and still carry an old name').toEqual([])
  })

  it('keeps every living file free of the old names, allowing only the historical records', () => {
    const allowed = new Set(ALLOWLIST.map((a) => a.path))
    const offending = trackedFiles()
      .filter((f) => !allowed.has(f))
      .flatMap((f) => hits(f, TITLE_CASE_OLD_NAME))
    expect(offending, 'these lines are readable in living files and still carry an old name').toEqual([])
  })

  it('has no rotten allowlist entries', () => {
    for (const { path } of ALLOWLIST) {
      expect(existsSync(path), `${path} is allowlisted but no longer exists`).toBe(true)
      expect(
        hits(path, TITLE_CASE_OLD_NAME).length,
        `${path} is allowlisted but no longer contains an old name; remove the entry`,
      ).toBeGreaterThan(0)
    }
  })
})
