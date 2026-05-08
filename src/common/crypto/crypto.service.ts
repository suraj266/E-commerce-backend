/**
 * CryptoService — AES-256-GCM encryption/decryption for sensitive data.
 *
 * Used by PaymentConfigService to encrypt gateway credentials before
 * storing in the database. The encryption key comes from env var
 * PAYMENT_ENCRYPTION_KEY (32-byte hex string).
 *
 * Format: iv:authTag:cipherText (all base64-encoded)
 *
 * Usage:
 *   const encrypted = cryptoService.encrypt('{"keyId":"rzp_test_xxx"}');
 *   const decrypted = cryptoService.decrypt(encrypted);
 */

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'crypto';

@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor(private readonly config: ConfigService) {
    const hex = this.config.get<string>('PAYMENT_ENCRYPTION_KEY');
    if (!hex || hex.length !== 64) {
      throw new Error(
        'PAYMENT_ENCRYPTION_KEY must be a 64-char hex string (32 bytes). ' +
          'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
      );
    }
    this.key = Buffer.from(hex, 'hex');
  }

  /**
   * Encrypt plaintext using AES-256-GCM.
   * Returns `iv:authTag:cipherText` with each segment base64-encoded.
   */
  encrypt(plainText: string): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);

    let encrypted = cipher.update(plainText, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    const authTag = cipher.getAuthTag();
    return [
      iv.toString('base64'),
      authTag.toString('base64'),
      encrypted,
    ].join(':');
  }

  /**
   * Decrypt a string produced by `encrypt()`.
   * Throws on tampered or invalid ciphertext (auth tag mismatch).
   */
  decrypt(encrypted: string): string {
    const [ivB64, tagB64, cipherB64] = encrypted.split(':');
    if (!ivB64 || !tagB64 || !cipherB64) {
      throw new Error('Invalid encrypted format — expected iv:tag:cipher');
    }

    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(tagB64, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(cipherB64, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
}
