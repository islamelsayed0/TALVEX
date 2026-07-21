import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Placeholder suite for Task 2: CI needs something real to run. It guards the
// secret hygiene rule in CLAUDE.md rather than asserting a trivial truth, so a
// green check here means something. Replaced in importance (not deleted) by
// tests/isolation/ in Task 5.

const gitignore = readFileSync('.gitignore', 'utf8')
const example = readFileSync('.env.example', 'utf8')

describe('env hygiene', () => {
  it('ignores real env files but keeps .env.example tracked', () => {
    expect(gitignore).toMatch(/^\.env\*$/m)
    expect(gitignore).toMatch(/^!\.env\.example$/m)
  })

  it('documents every variable the app needs', () => {
    for (const name of [
      'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
      'CLERK_SECRET_KEY',
      'NEXT_PUBLIC_CLERK_SIGN_IN_URL',
      'NEXT_PUBLIC_CLERK_SIGN_UP_URL',
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
    ]) {
      expect(example).toContain(name)
    }
  })

  it('carries no real credentials, only placeholders', () => {
    // Find anything shaped like a key Clerk or Supabase actually issues, then
    // require its body to be the xxx template rather than a real value.
    const keyish = /(?:sk_(?:test|live)|pk_(?:test|live)|sb_publishable)_([A-Za-z0-9_-]{16,})/g
    for (const [, body] of example.matchAll(keyish)) {
      expect(body).toMatch(/^x+$/)
    }
    // A Supabase legacy anon/service key is a JWT; no placeholder looks like one.
    expect(example).not.toMatch(/eyJhbGciOi[A-Za-z0-9._-]+/)
  })

  it('never exposes a server secret through a NEXT_PUBLIC_ name', () => {
    const publicNames = [...example.matchAll(/^(NEXT_PUBLIC_\w+)=/gm)].map((m) => m[1])
    expect(publicNames.length).toBeGreaterThan(0)
    for (const name of publicNames) {
      expect(name).not.toMatch(/SECRET|SERVICE_ROLE|PRIVATE/)
    }
  })
})
