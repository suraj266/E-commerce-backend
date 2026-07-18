/**
 * gcm-crypto.util.ts — standalone AES-256-GCM primitives for the one-shot
 * gateway-credential re-encryption script.
 *
 * WHY NOT reuse CryptoService?
 *   CryptoService is a Nest provider that reads a *single* PAYMENT_ENCRYPTION_KEY
 *   from ConfigService at construction time. Key rotation needs *two* keys held
 *   at once (old + new) and no DI container, so we re-implement the identical
 *   primitives here as pure, dependency-free functions.
 *
 * Ciphertext format — byte-for-byte identical to CryptoService.encrypt():
 *   ivB64:tagB64:cipherB64      (three base64 segments joined by ':')
 *   iv  = 16 random bytes
 *   alg = aes-256-gcm, 16-byte auth tag
 * so ciphertext produced here decrypts in the running app and vice-versa.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const HEX_KEY_RE = /^[0-9a-fA-F]{64}$/;

/** True iff `hex` is exactly 64 hex chars (a 32-byte AES-256 key). */
export function isValidKeyHex(hex: string | undefined | null): boolean {
  return typeof hex === 'string' && HEX_KEY_RE.test(hex);
}

/** Validate + decode a 64-hex key into a 32-byte Buffer, or throw. */
export function keyBufferFromHex(hex: string | undefined | null, label = 'key'): Buffer {
  if (typeof hex !== 'string' || !HEX_KEY_RE.test(hex)) {
    const got = typeof hex === 'string' ? `${hex.length} chars` : 'empty/undefined';
    throw new Error(
      `${label} must be a 64-char hex string (32 bytes). Got ${got}. ` +
        `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
    );
  }
  return Buffer.from(hex, 'hex');
}

/** Encrypt UTF-8 plaintext with a 64-hex key. Returns ivB64:tagB64:cipherB64. */
export function encryptGcm(plainText: string, keyHex: string): string {
  const key = keyBufferFromHex(keyHex);
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(plainText, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  const authTag = cipher.getAuthTag();
  return [iv.toString('base64'), authTag.toString('base64'), encrypted].join(':');
}

/** Decrypt an ivB64:tagB64:cipherB64 string with a 64-hex key. Throws on tamper. */
export function decryptGcm(encrypted: string, keyHex: string): string {
  const key = keyBufferFromHex(keyHex);
  const [ivB64, tagB64, cipherB64] = (encrypted ?? '').split(':');
  if (!ivB64 || !tagB64 || !cipherB64) {
    throw new Error('Invalid encrypted format — expected ivB64:tagB64:cipherB64');
  }

  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(cipherB64, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Decrypt a ciphertext with `oldKeyHex`, re-encrypt with `newKeyHex`, and
 * VERIFY the result round-trips back to the original plaintext under the new
 * key before returning it. Guarantees a caller never persists a value it
 * cannot read back. Throws (aborting the whole rotation) if anything fails.
 */
export function reencrypt(ciphertext: string, oldKeyHex: string, newKeyHex: string): string {
  const plain = decryptGcm(ciphertext, oldKeyHex);
  const next = encryptGcm(plain, newKeyHex);
  const verify = decryptGcm(next, newKeyHex);
  if (verify !== plain) {
    throw new Error('Round-trip verification failed after re-encryption (new ciphertext did not decrypt back to the original).');
  }
  return next;
}

/**
 * Mask a secret for safe logging: keep a short prefix/suffix, redact the middle.
 * Never returns the full value regardless of length.
 */
export function maskSecret(value: unknown): string {
  const str = String(value ?? '');
  if (str.length === 0) return '(empty)';
  if (str.length <= 4) return '••••';
  if (str.length <= 8) return `${str.slice(0, 2)}••••`;
  return `${str.slice(0, 4)}••••${str.slice(-2)}`;
}
