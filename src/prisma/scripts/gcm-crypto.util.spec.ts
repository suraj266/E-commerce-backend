import {
  decryptGcm,
  encryptGcm,
  isValidKeyHex,
  keyBufferFromHex,
  maskSecret,
  reencrypt,
} from './gcm-crypto.util';

// Two distinct valid 32-byte (64-hex) keys.
const OLD_KEY = 'a'.repeat(64);
const NEW_KEY = 'b'.repeat(64);

describe('gcm-crypto.util', () => {
  describe('isValidKeyHex', () => {
    it('accepts exactly 64 hex chars', () => {
      expect(isValidKeyHex(OLD_KEY)).toBe(true);
      expect(isValidKeyHex('0123456789abcdefABCDEF'.padEnd(64, '0'))).toBe(true);
    });

    it('rejects wrong length / non-hex / empty', () => {
      expect(isValidKeyHex('a'.repeat(63))).toBe(false);
      expect(isValidKeyHex('a'.repeat(65))).toBe(false);
      expect(isValidKeyHex('z'.repeat(64))).toBe(false);
      expect(isValidKeyHex('')).toBe(false);
      expect(isValidKeyHex(undefined)).toBe(false);
      expect(isValidKeyHex(null)).toBe(false);
    });
  });

  describe('keyBufferFromHex', () => {
    it('decodes a valid key to 32 bytes', () => {
      expect(keyBufferFromHex(OLD_KEY)).toHaveLength(32);
    });

    it('throws with the label on an invalid key', () => {
      expect(() => keyBufferFromHex('nope', 'OLD_PAYMENT_ENCRYPTION_KEY')).toThrow(
        /OLD_PAYMENT_ENCRYPTION_KEY/,
      );
    });
  });

  describe('encrypt/decrypt', () => {
    it('round-trips under the same key', () => {
      const plain = JSON.stringify({ keyId: 'rzp_test_abc', keySecret: 'super-secret-value' });
      const ct = encryptGcm(plain, OLD_KEY);
      expect(ct.split(':')).toHaveLength(3);
      expect(decryptGcm(ct, OLD_KEY)).toBe(plain);
    });

    it('produces a fresh IV each call (ciphertexts differ)', () => {
      const a = encryptGcm('x', OLD_KEY);
      const b = encryptGcm('x', OLD_KEY);
      expect(a).not.toBe(b);
    });

    it('fails to decrypt with the wrong key (auth tag mismatch)', () => {
      const ct = encryptGcm('secret', OLD_KEY);
      expect(() => decryptGcm(ct, NEW_KEY)).toThrow();
    });

    it('throws on a malformed ciphertext string', () => {
      expect(() => decryptGcm('not-valid', OLD_KEY)).toThrow(/Invalid encrypted format/);
    });
  });

  describe('reencrypt (old -> new -> decrypt)', () => {
    it('re-encrypts so the value decrypts under the NEW key but not the OLD', () => {
      const plain = JSON.stringify({ keyId: 'rzp_live_xyz', keySecret: 'live-secret' });
      const oldCt = encryptGcm(plain, OLD_KEY);

      const newCt = reencrypt(oldCt, OLD_KEY, NEW_KEY);

      // The proof: new key reads it back to the exact original plaintext...
      expect(decryptGcm(newCt, NEW_KEY)).toBe(plain);
      // ...and the old key can no longer read it.
      expect(() => decryptGcm(newCt, OLD_KEY)).toThrow();
    });

    it('throws if the source ciphertext does not decrypt under the old key', () => {
      const foreign = encryptGcm('data', NEW_KEY);
      expect(() => reencrypt(foreign, OLD_KEY, NEW_KEY)).toThrow();
    });
  });

  describe('maskSecret', () => {
    it('never returns the full value', () => {
      expect(maskSecret('rzp_live_1234567890')).not.toContain('567890');
      expect(maskSecret('rzp_live_1234567890')).toMatch(/^rzp_••••90$/);
    });

    it('fully redacts short values and handles empty', () => {
      expect(maskSecret('abcd')).toBe('••••');
      expect(maskSecret('')).toBe('(empty)');
      expect(maskSecret(undefined)).toBe('(empty)');
    });
  });
});
