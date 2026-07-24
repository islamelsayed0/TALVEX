import { describe, expect, it } from 'vitest'

// A plain ESM script rather than a module under src/: it is CI tooling, not
// app code, and CI runs it with bare `node`. Its JSDoc carries the types, so
// importing it here keeps the comparison logic under test without a database.
import {
  compareMigrationHistories,
  versionsFromFileNames,
} from '../scripts/check-migration-drift.mjs'

// The guard that stops a merged migration reaching main without reaching the
// database (docs/DECISIONS.md, migration drift guard). The comparison is pure,
// so the interesting cases are all testable here; the CI job supplies the real
// git and psql readings.

describe('versionsFromFileNames', () => {
  it('takes the leading timestamp off each migration file name', () => {
    expect(
      versionsFromFileNames([
        '20260721190000_001_org_foundation.sql',
        '20260724100100_008_chat.sql',
      ]),
    ).toEqual(['20260721190000', '20260724100100'])
  })

  it('ignores anything that is not a versioned .sql file', () => {
    expect(
      versionsFromFileNames(['README.md', '.gitkeep', 'no_version.sql', '']),
    ).toEqual([])
  })

  it('sorts, so callers never depend on directory order', () => {
    expect(
      versionsFromFileNames(['20260724100100_008.sql', '20260721190000_001.sql']),
    ).toEqual(['20260721190000', '20260724100100'])
  })
})

describe('compareMigrationHistories', () => {
  it('passes when every merged migration is applied', () => {
    const report = compareMigrationHistories({
      merged: ['001', '002'],
      working: ['001', '002'],
      applied: ['001', '002'],
    })
    expect(report.ok).toBe(true)
    expect(report.unapplied).toEqual([])
    expect(report.unknown).toEqual([])
  })

  it('FAILS when a merged migration was never applied: the production fault', () => {
    // The exact shape of the Phase 1 Task 5 fault: the file is on main, the
    // database has never run it, and the app is already calling the schema.
    const report = compareMigrationHistories({
      merged: ['001', '002'],
      working: ['001', '002'],
      applied: ['001'],
    })
    expect(report.ok).toBe(false)
    expect(report.unapplied).toEqual(['002'])
  })

  it("reports, and does not fail on, a migration the branch itself adds", () => {
    // A PR's own migration has not merged, so it is not yet a promise. This is
    // what keeps the guard usable on the PR that introduces schema.
    const report = compareMigrationHistories({
      merged: ['001'],
      working: ['001', '002'],
      applied: ['001'],
    })
    expect(report.ok).toBe(true)
    expect(report.incoming).toEqual(['002'])
    expect(report.unapplied).toEqual([])
  })

  it("notes when the branch's own migration is already applied", () => {
    const report = compareMigrationHistories({
      merged: ['001'],
      working: ['001', '002'],
      applied: ['001', '002'],
    })
    expect(report.ok).toBe(true)
    expect(report.ready).toEqual(['002'])
    expect(report.incoming).toEqual([])
  })

  it('FAILS on a version applied by hand with no file behind it', () => {
    // The drift this whole PR exists to clean up: SQL pasted into the
    // dashboard, recorded remotely, explained by nothing in the repository.
    const report = compareMigrationHistories({
      merged: ['001'],
      working: ['001'],
      applied: ['001', '999'],
    })
    expect(report.ok).toBe(false)
    expect(report.unknown).toEqual(['999'])
  })

  it('does not accuse a branch that simply predates a newly merged migration', () => {
    // 002 merged to main and was applied while this branch was open. It is
    // absent from the branch but present in merged, so it is neither drift
    // nor hand applied SQL; it is a stale branch, which rebasing fixes.
    const report = compareMigrationHistories({
      merged: ['001', '002'],
      working: ['001'],
      applied: ['001', '002'],
    })
    expect(report.ok).toBe(true)
    expect(report.unknown).toEqual([])
  })

  it('holds every migration to the merged standard when there is no base ref', () => {
    // How a push to main runs: merged and working are the same ref, so a
    // migration that just merged unapplied fails immediately.
    const versions = ['001', '002']
    const report = compareMigrationHistories({
      merged: versions,
      working: versions,
      applied: ['001'],
    })
    expect(report.ok).toBe(false)
    expect(report.unapplied).toEqual(['002'])
    expect(report.incoming).toEqual([])
  })

  it('reports both failure modes at once rather than stopping at the first', () => {
    const report = compareMigrationHistories({
      merged: ['001', '002'],
      working: ['001', '002'],
      applied: ['001', '999'],
    })
    expect(report.ok).toBe(false)
    expect(report.unapplied).toEqual(['002'])
    expect(report.unknown).toEqual(['999'])
  })
})
