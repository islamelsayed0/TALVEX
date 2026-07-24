// The migration drift guard (docs/future_update.md housekeeping item).
//
// Twice in two days, merged code assumed schema the live database did not
// have, and both times the first symptom was a 500 in production. The cause
// was always the same shape: a migration file merged to main that nobody
// applied to the shared Supabase project. This script makes CI notice that
// before a human does.
//
// What it compares, and why those three sets:
//   merged  - migration versions on the base branch. These are the promises
//             already made. Every one of them MUST be applied. This is the
//             assertion that fails the build.
//   working - versions in this checkout. On a PR that is merged plus the
//             migrations the PR adds; those are reported, never failed on,
//             because a PR's own migration has not merged yet.
//   applied - versions the remote project records in
//             supabase_migrations.schema_migrations.
//
// It also fails when the remote records a version that exists in neither set:
// that is SQL applied by hand in the dashboard with no file behind it, which
// is precisely the drift that made `supabase db push` unusable in the first
// place.
//
// The comparison is a pure function so it can be unit tested without a
// database (tests/migration-drift.test.ts); everything below main() is I/O.

import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'

const MIGRATIONS_DIR = 'supabase/migrations'

/**
 * A migration file name is `<version>_<name>.sql`; the version is the leading
 * timestamp and is what the remote history table keys on.
 * @param {string[]} fileNames
 * @returns {string[]} sorted, deduplicated versions
 */
export function versionsFromFileNames(fileNames) {
  const versions = fileNames
    .filter((f) => f.endsWith('.sql'))
    .map((f) => /^(\d+)_/.exec(f)?.[1])
    .filter((v) => typeof v === 'string')
  return [...new Set(versions)].sort()
}

/**
 * @typedef {object} DriftReport
 * @property {string[]} unapplied Merged migrations the database has never run. Fatal.
 * @property {string[]} unknown   Applied versions with no file anywhere. Fatal.
 * @property {string[]} incoming  Migrations this branch adds, not yet applied. Informational.
 * @property {string[]} ready     Migrations this branch adds that are already applied. Informational.
 * @property {boolean} ok         True when nothing fatal was found.
 */

/**
 * @param {{merged: string[], working: string[], applied: string[]}} input
 * @returns {DriftReport}
 */
export function compareMigrationHistories({ merged, working, applied }) {
  const appliedSet = new Set(applied)
  const mergedSet = new Set(merged)
  const workingSet = new Set(working)

  const unapplied = merged.filter((v) => !appliedSet.has(v)).sort()

  // Anything the branch has that the base branch does not is this PR's own
  // work. On a push to main, merged and working are the same ref, so this is
  // empty and every migration is held to the merged standard.
  const added = working.filter((v) => !mergedSet.has(v))
  const incoming = added.filter((v) => !appliedSet.has(v)).sort()
  const ready = added.filter((v) => appliedSet.has(v)).sort()

  // A version the database has run that no file explains. Checked against
  // both sets so a branch that simply predates a newly merged migration is
  // not accused of hand applied SQL.
  const unknown = applied
    .filter((v) => !mergedSet.has(v) && !workingSet.has(v))
    .sort()

  return {
    unapplied,
    unknown,
    incoming,
    ready,
    ok: unapplied.length === 0 && unknown.length === 0,
  }
}

// ---------------------------------------------------------------------------
// I/O

/** @param {string} ref @returns {string[]} */
function versionsAtRef(ref) {
  const out = execFileSync(
    'git',
    ['ls-tree', '-r', '--name-only', ref, '--', MIGRATIONS_DIR],
    { encoding: 'utf8' },
  )
  return versionsFromFileNames(
    out.split('\n').map((line) => line.split('/').pop() ?? ''),
  )
}

/** @returns {string[]} */
function versionsInWorkingTree() {
  return versionsFromFileNames(readdirSync(MIGRATIONS_DIR))
}

/** @param {string} dbUrl @returns {string[]} */
function versionsAppliedRemotely(dbUrl) {
  const out = execFileSync(
    'psql',
    [
      dbUrl,
      '--no-psqlrc',
      '--tuples-only',
      '--no-align',
      '--set=ON_ERROR_STOP=1',
      '--command',
      'select version from supabase_migrations.schema_migrations order by version',
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  )
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .sort()
}

function main() {
  const args = process.argv.slice(2)
  const allowUnconfigured = args.includes('--allow-unconfigured')
  const baseRef = process.env.MIGRATION_GUARD_BASE_REF ?? ''
  const dbUrl = process.env.SUPABASE_DB_URL ?? ''

  if (!dbUrl) {
    const message =
      'SUPABASE_DB_URL is not set, so migration drift cannot be checked.\n' +
      '  Configure it once with:\n' +
      '    gh secret set SUPABASE_DB_URL\n' +
      '  Use the Supabase project\'s connection string (Project Settings, Database,\n' +
      '  Connection string, URI). Then drop --allow-unconfigured from .github/workflows/ci.yml\n' +
      '  so this guard is mandatory rather than best effort.'
    if (allowUnconfigured) {
      console.warn(`::warning title=Migration drift guard is not armed::${message}`)
      console.warn(`\nSKIPPED: ${message}\n`)
      return
    }
    console.error(`\nFAILED: ${message}\n`)
    process.exit(1)
  }

  const working = versionsInWorkingTree()
  // No base ref means "hold everything in this checkout to the merged
  // standard", which is what a push to main wants.
  const merged = baseRef ? versionsAtRef(baseRef) : working
  const applied = versionsAppliedRemotely(dbUrl)

  const report = compareMigrationHistories({ merged, working, applied })

  console.log(`Base ref:        ${baseRef || '(none, checking every migration here)'}`)
  console.log(`Migration files: ${working.length}`)
  console.log(`Applied remotely: ${applied.length}`)

  for (const version of report.ready) {
    console.log(`  ok       ${version} added by this branch, already applied`)
  }
  for (const version of report.incoming) {
    console.log(`  pending  ${version} added by this branch, not applied yet`)
  }

  if (report.ok) {
    if (report.incoming.length > 0) {
      console.log(
        '\nNo drift. Apply the pending migration(s) to the shared project BEFORE\n' +
          'merging, so main is never briefly ahead of the database.',
      )
    } else {
      console.log('\nNo drift. Every merged migration is applied.')
    }
    return
  }

  console.error('\nMIGRATION DRIFT DETECTED\n')
  if (report.unapplied.length > 0) {
    console.error(
      'These migrations are merged but the database has never run them.\n' +
        'Production is running against schema that does not match this branch:',
    )
    for (const version of report.unapplied) console.error(`  MISSING  ${version}`)
    console.error('\n  Fix: npx supabase db push\n')
  }
  if (report.unknown.length > 0) {
    console.error(
      'The database records migrations that no file explains. Someone applied\n' +
        'SQL by hand, or a migration file was deleted after it was applied:',
    )
    for (const version of report.unknown) console.error(`  UNTRACKED  ${version}`)
    console.error(
      '\n  Fix: commit the missing migration file, or reconcile the history with\n' +
        '       npx supabase migration repair --status reverted <version>\n',
    )
  }
  process.exit(1)
}

// Only run when invoked directly, so tests can import the pure function.
if (process.argv[1] && process.argv[1].endsWith('check-migration-drift.mjs')) {
  main()
}
