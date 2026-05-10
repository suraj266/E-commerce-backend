/**
 * EmailConfigService — singleton SMTP settings (id="default").
 *
 * Password is stored AES-256-GCM-encrypted via the shared CryptoService
 * (key: PAYMENT_ENCRYPTION_KEY env var). Plaintext is never returned via
 * GraphQL — only `hasPassword: boolean` and the boolean `isConfigured`.
 *
 * `EmailService` calls `getDecryptedPassword()` internally when building
 * the nodemailer transport. Do not expose this method via any resolver.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CryptoService } from '@/common/crypto/crypto.service';
import { UpdateEmailSettingInput } from './dto/update-email-setting.input';

const SINGLETON_ID = 'default';

@Injectable()
export class EmailConfigService {
  private readonly logger = new Logger(EmailConfigService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /**
   * Returns the singleton row, auto-creating with defaults if missing.
   * Self-healing — the migration also seeds it but this protects reads.
   */
  async findGlobal() {
    const existing = await this.prisma.emailSetting.findUnique({
      where: { id: SINGLETON_ID },
    });
    if (existing) return existing;
    return this.prisma.emailSetting.create({
      data: { id: SINGLETON_ID },
    });
  }

  /**
   * Public-safe shape for the admin UI — strips encrypted password,
   * exposes `hasPassword` and computed `isConfigured`.
   */
  async getSafe() {
    const row = await this.findGlobal();
    return {
      id: row.id,
      mailer: row.mailer,
      host: row.host,
      port: row.port,
      username: row.username,
      encryption: row.encryption,
      senderName: row.senderName,
      senderEmail: row.senderEmail,
      localDomain: row.localDomain,
      isConfigured: row.isConfigured,
      hasPassword: row.passwordEnc.length > 0,
      updatedAt: row.updatedAt,
    };
  }

  async update(input: UpdateEmailSettingInput, userId?: string) {
    await this.findGlobal();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: Record<string, any> = {};
    if (input.mailer !== undefined) data.mailer = input.mailer;
    if (input.host !== undefined) data.host = input.host;
    if (input.port !== undefined) data.port = input.port;
    if (input.username !== undefined) data.username = input.username;
    if (input.encryption !== undefined) data.encryption = input.encryption;
    if (input.senderName !== undefined) data.senderName = input.senderName;
    if (input.senderEmail !== undefined) data.senderEmail = input.senderEmail;
    if (input.localDomain !== undefined) data.localDomain = input.localDomain;

    // Only re-encrypt when a non-empty password is provided. An empty string
    // means "leave the existing one alone" — admin saving the form without
    // retyping the password should not blow it away.
    if (input.password && input.password.length > 0) {
      data.passwordEnc = this.crypto.encrypt(input.password);
    }

    if (userId) data.updatedById = userId;

    // Recompute isConfigured based on the merged state.
    const merged = {
      host: data.host ?? (await this.findGlobal()).host,
      username: data.username ?? (await this.findGlobal()).username,
      senderEmail:
        data.senderEmail ?? (await this.findGlobal()).senderEmail,
      passwordEnc:
        data.passwordEnc ?? (await this.findGlobal()).passwordEnc,
    };
    data.isConfigured = Boolean(
      merged.host &&
        merged.username &&
        merged.senderEmail &&
        merged.passwordEnc,
    );

    const row = await this.prisma.emailSetting.update({
      where: { id: SINGLETON_ID },
      data,
    });

    this.logger.log(
      `Email settings updated (configured=${row.isConfigured}, host=${row.host || '<unset>'})`,
    );
    return this.getSafe();
  }

  /**
   * INTERNAL ONLY — used by EmailService when building the nodemailer transport.
   * Never call this from a resolver.
   */
  async getDecryptedPassword(): Promise<string> {
    const row = await this.findGlobal();
    if (!row.passwordEnc) return '';
    try {
      return this.crypto.decrypt(row.passwordEnc);
    } catch (err) {
      this.logger.error(
        `Failed to decrypt SMTP password: ${(err as Error).message}`,
      );
      return '';
    }
  }
}
