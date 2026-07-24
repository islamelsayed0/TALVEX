import 'server-only'

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'

/**
 * Application layer encryption for BYOK provider keys (Task 5 ruling 2).
 *
 * A provider key is encrypted with AES 256 GCM BEFORE it ever reaches Postgres
 * and decrypted only server side, in request scope, at the moment of a provider
 * call. The plaintext never enters the database, and this module is the one
 * place that touches it. GCM is authenticated: tampering with the stored
 * ciphertext fails the auth tag on decrypt rather than returning garbage, so a
 * modified row is a loud error, not a silent wrong key.
 *
 * The 32 byte key comes from API_KEY_ENCRYPTION_SECRET (64 hex characters,
 * `openssl rand -hex 32`), which lives only in server environment secrets:
 * never in the database, never in the repo (documented by name in
 * .env.example). 'server-only' makes any client bundle inclusion a build error.
 *
 * NOTHING key shaped is ever logged here (ruling 4): not the plaintext, not the
 * ciphertext, not the secret. The error paths carry only a fixed message.
 */

/** The stored format: a version tag, then base64 of iv (12) || tag (16) || ct. */
const FORMAT_VERSION = 'v1'
const IV_BYTES = 12
const TAG_BYTES = 16
const KEY_BYTES = 32

/** Thrown when the encryption secret is missing or malformed. Never carries key material. */
export class EncryptionKeyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EncryptionKeyError'
  }
}

/** Thrown when ciphertext cannot be authenticated or parsed. Never carries key material. */
export class KeyDecryptionError extends Error {
  constructor() {
    super('Stored key could not be decrypted. It may be corrupt or the encryption secret changed.')
    this.name = 'KeyDecryptionError'
  }
}

function encryptionKey(): Buffer {
  const secret = process.env.API_KEY_ENCRYPTION_SECRET
  if (!secret) {
    throw new EncryptionKeyError(
      'API_KEY_ENCRYPTION_SECRET is not set. It lives in .env.local and in ' +
        'Vercel env vars, never in the repo. Generate with: openssl rand -hex 32.',
    )
  }
  // 64 hex characters decode to exactly 32 bytes. Anything else is a
  // misconfiguration we refuse loudly rather than silently truncate or pad.
  if (!/^[0-9a-fA-F]{64}$/.test(secret)) {
    throw new EncryptionKeyError(
      'API_KEY_ENCRYPTION_SECRET must be 64 hex characters (32 bytes). ' +
        'Generate with: openssl rand -hex 32.',
    )
  }
  const key = Buffer.from(secret, 'hex')
  if (key.length !== KEY_BYTES) {
    throw new EncryptionKeyError('API_KEY_ENCRYPTION_SECRET did not decode to 32 bytes.')
  }
  return key
}

/**
 * Encrypt a provider key. Returns the string stored in org_api_keys.encrypted_key:
 * `v1.<base64 of iv || auth tag || ciphertext>`. A fresh random IV per call
 * means the same key encrypts to a different value every time.
 */
export function encryptApiKey(plaintext: string): string {
  const key = encryptionKey()
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  const packed = Buffer.concat([iv, tag, ciphertext]).toString('base64')
  return `${FORMAT_VERSION}.${packed}`
}

/**
 * Decrypt a stored provider key. Throws KeyDecryptionError if the blob is
 * malformed or the auth tag does not verify (tampering, wrong secret). The
 * plaintext exists only in the returned value, in the caller's request scope.
 */
export function decryptApiKey(blob: string): string {
  const key = encryptionKey()
  const dot = blob.indexOf('.')
  if (dot === -1 || blob.slice(0, dot) !== FORMAT_VERSION) {
    throw new KeyDecryptionError()
  }
  let packed: Buffer
  try {
    packed = Buffer.from(blob.slice(dot + 1), 'base64')
  } catch {
    throw new KeyDecryptionError()
  }
  if (packed.length < IV_BYTES + TAG_BYTES + 1) {
    throw new KeyDecryptionError()
  }
  const iv = packed.subarray(0, IV_BYTES)
  const tag = packed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES)
  const ciphertext = packed.subarray(IV_BYTES + TAG_BYTES)
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ])
    return plaintext.toString('utf8')
  } catch {
    // final() throws on a failed auth tag. Swallow the underlying message so no
    // key or cipher detail can leak into a log or error trace.
    throw new KeyDecryptionError()
  }
}

/**
 * The last four characters of a key, the only key derived value ever shown in
 * the UI. Short or empty keys are rejected at validation, so this is safe.
 */
export function lastFour(plaintext: string): string {
  return plaintext.slice(-4)
}

/**
 * Constant time comparison for the rare place two secrets are compared. Not on
 * the hot path today, exported so no caller reaches for `===` on key material.
 */
export function secretsEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}
