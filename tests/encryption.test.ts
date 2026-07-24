import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  decryptApiKey,
  encryptApiKey,
  EncryptionKeyError,
  KeyDecryptionError,
  lastFour,
} from '@/lib/chat/encryption'

// Encryption unit tests for the BYOK vault (Task 5). Obviously fake key
// material only, no real provider keys anywhere (gitleaks:allow below is a
// 64 hex test secret, not a credential).
const TEST_SECRET = 'a1b2c3d4'.repeat(8) // 64 hex chars = 32 bytes // gitleaks:allow
const SAMPLE_KEY = 'FAKEKEY-abcdefghijklmnopqrstuvwxyz-0000'

beforeAll(() => {
  process.env.API_KEY_ENCRYPTION_SECRET = TEST_SECRET
})

afterAll(() => {
  delete process.env.API_KEY_ENCRYPTION_SECRET
})

describe('AES 256 GCM key encryption', () => {
  it('round trips a key through encrypt and decrypt', () => {
    const blob = encryptApiKey(SAMPLE_KEY)
    expect(decryptApiKey(blob)).toBe(SAMPLE_KEY)
  })

  it('produces a different ciphertext each time (random IV)', () => {
    const a = encryptApiKey(SAMPLE_KEY)
    const b = encryptApiKey(SAMPLE_KEY)
    expect(a).not.toBe(b)
    // Both still decrypt to the same key.
    expect(decryptApiKey(a)).toBe(SAMPLE_KEY)
    expect(decryptApiKey(b)).toBe(SAMPLE_KEY)
  })

  it('never stores the plaintext: the ciphertext contains no fragment of the key', () => {
    const blob = encryptApiKey(SAMPLE_KEY)
    expect(blob).not.toContain(SAMPLE_KEY)
    // Not even the tail that becomes the displayed last four.
    expect(blob).not.toContain(SAMPLE_KEY.slice(-8))
  })

  it('detects tampering: a modified ciphertext fails authentication rather than decrypting to garbage', () => {
    const blob = encryptApiKey(SAMPLE_KEY)
    const [version, packed] = blob.split('.')
    const bytes = Buffer.from(packed, 'base64')
    // Flip one bit in the ciphertext region (past iv 12 + tag 16 bytes).
    bytes[bytes.length - 1] ^= 0x01
    const tampered = `${version}.${bytes.toString('base64')}`
    expect(() => decryptApiKey(tampered)).toThrow(KeyDecryptionError)
  })

  it('rejects a malformed blob', () => {
    expect(() => decryptApiKey('not-a-blob')).toThrow(KeyDecryptionError)
    expect(() => decryptApiKey('v1.short')).toThrow(KeyDecryptionError)
    expect(() => decryptApiKey('v2.' + Buffer.from('x'.repeat(40)).toString('base64'))).toThrow(
      KeyDecryptionError,
    )
  })

  it('lastFour returns the trailing four characters', () => {
    expect(lastFour(SAMPLE_KEY)).toBe(SAMPLE_KEY.slice(-4))
  })
})

describe('encryption secret hygiene', () => {
  it('refuses to run without the secret', () => {
    const saved = process.env.API_KEY_ENCRYPTION_SECRET
    delete process.env.API_KEY_ENCRYPTION_SECRET
    try {
      expect(() => encryptApiKey(SAMPLE_KEY)).toThrow(EncryptionKeyError)
    } finally {
      process.env.API_KEY_ENCRYPTION_SECRET = saved
    }
  })

  it('refuses a secret that is not 64 hex characters', () => {
    const saved = process.env.API_KEY_ENCRYPTION_SECRET
    process.env.API_KEY_ENCRYPTION_SECRET = 'too-short'
    try {
      expect(() => encryptApiKey(SAMPLE_KEY)).toThrow(EncryptionKeyError)
    } finally {
      process.env.API_KEY_ENCRYPTION_SECRET = saved
    }
  })
})
