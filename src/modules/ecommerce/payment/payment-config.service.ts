/**
 * PaymentConfigService — Admin CRUD for PaymentGatewayConfig.
 *
 * Handles:
 *   - Listing all gateway configs (credentials always masked)
 *   - Creating/updating configs (encrypts credentials before save)
 *   - Toggling enabled/disabled
 *   - Providing decrypted credentials to PaymentService (internal only)
 *
 * Credentials flow:
 *   Admin sends raw JSON → encrypt → save to DB
 *   Checkout needs credentials → load from DB → decrypt → pass to gateway
 */

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentGateway } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { CryptoService } from '@/common/crypto/crypto.service';
import {
  CreateGatewayConfigInput,
  UpdateGatewayConfigInput,
} from './dto/gateway-config.input';

@Injectable()
export class PaymentConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
  ) {}

  // ---------------------------------------------------------------------------
  // Reads (admin)
  // ---------------------------------------------------------------------------

  async list() {
    const rows = await this.prisma.paymentGatewayConfig.findMany({
      orderBy: { displayOrder: 'asc' },
    });
    return rows.map((r) => this.toSafeShape(r));
  }

  async getById(id: string) {
    const row = await this.prisma.paymentGatewayConfig.findUnique({
      where: { id },
    });
    if (!row) throw new NotFoundException('Gateway config not found.');
    return this.toSafeShape(row);
  }

  /** Returns enabled gateways for the customer checkout page. */
  async getActiveGateways() {
    const rows = await this.prisma.paymentGatewayConfig.findMany({
      where: { isEnabled: true },
      orderBy: { displayOrder: 'asc' },
    });
    return rows.map((r) => this.toSafeShape(r));
  }

  // ---------------------------------------------------------------------------
  // Mutations (admin)
  // ---------------------------------------------------------------------------

  async create(input: CreateGatewayConfigInput) {
    // Check uniqueness on gateway enum
    const existing = await this.prisma.paymentGatewayConfig.findUnique({
      where: { gateway: input.gateway },
    });
    if (existing) {
      throw new BadRequestException(
        `A configuration for ${input.gateway} already exists.`,
      );
    }

    const encrypted = input.credentialsJson
      ? this.crypto.encrypt(input.credentialsJson)
      : '';

    const backendUrl = this.config.get<string>('LOCAL_PUBLIC_BASE_URL') ?? 'http://localhost:7000';
    const webhookUrl = `${backendUrl}/webhooks/${input.gateway.toLowerCase()}`;

    // If this is set as default, unset other defaults
    if (input.isDefault) {
      await this.prisma.paymentGatewayConfig.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }

    const row = await this.prisma.paymentGatewayConfig.create({
      data: {
        gateway: input.gateway,
        displayName: input.displayName,
        description: input.description,
        logoUrl: input.logoUrl,
        isEnabled: input.isEnabled,
        isDefault: input.isDefault,
        displayOrder: input.displayOrder,
        supportedMethods: input.supportedMethods,
        credentials: encrypted,
        sandboxMode: input.sandboxMode,
        processingFee: input.processingFee,
        processingFeeType: input.processingFeeType,
        paymentType: input.paymentType,
        instructions: input.instructions,
        webhookUrl,
      },
    });
    return this.toSafeShape(row);
  }

  async update(input: UpdateGatewayConfigInput) {
    const existing = await this.prisma.paymentGatewayConfig.findUnique({
      where: { id: input.id },
    });
    if (!existing) throw new NotFoundException('Gateway config not found.');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: Record<string, any> = {};

    if (input.displayName !== undefined) data.displayName = input.displayName;
    if (input.description !== undefined) data.description = input.description;
    if (input.logoUrl !== undefined) data.logoUrl = input.logoUrl;
    if (input.isEnabled !== undefined) data.isEnabled = input.isEnabled;
    if (input.displayOrder !== undefined) data.displayOrder = input.displayOrder;
    if (input.supportedMethods !== undefined) data.supportedMethods = input.supportedMethods;
    if (input.sandboxMode !== undefined) data.sandboxMode = input.sandboxMode;
    if (input.processingFee !== undefined) data.processingFee = input.processingFee;
    if (input.processingFeeType !== undefined) data.processingFeeType = input.processingFeeType;
    if (input.paymentType !== undefined) data.paymentType = input.paymentType;
    if (input.instructions !== undefined) data.instructions = input.instructions;

    // Re-encrypt credentials if new ones provided
    if (input.credentialsJson) {
      data.credentials = this.crypto.encrypt(input.credentialsJson);
    }

    // Handle default toggle
    if (input.isDefault === true) {
      await this.prisma.paymentGatewayConfig.updateMany({
        where: { isDefault: true, id: { not: input.id } },
        data: { isDefault: false },
      });
      data.isDefault = true;
    } else if (input.isDefault === false) {
      data.isDefault = false;
    }

    const row = await this.prisma.paymentGatewayConfig.update({
      where: { id: input.id },
      data,
    });
    return this.toSafeShape(row);
  }

  async toggleEnabled(id: string, enabled: boolean) {
    const existing = await this.prisma.paymentGatewayConfig.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Gateway config not found.');

    const row = await this.prisma.paymentGatewayConfig.update({
      where: { id },
      data: { isEnabled: enabled },
    });
    return this.toSafeShape(row);
  }

  async setDefault(id: string) {
    await this.prisma.paymentGatewayConfig.updateMany({
      where: { isDefault: true },
      data: { isDefault: false },
    });
    const row = await this.prisma.paymentGatewayConfig.update({
      where: { id },
      data: { isDefault: true },
    });
    return this.toSafeShape(row);
  }

  // ---------------------------------------------------------------------------
  // Internal — used by PaymentService at checkout time
  // ---------------------------------------------------------------------------

  /**
   * Load and decrypt credentials for a gateway. INTERNAL USE ONLY —
   * never expose the return value via GraphQL.
   */
  async getDecryptedCredentials(
    gateway: PaymentGateway,
  ): Promise<Record<string, unknown>> {
    const config = await this.prisma.paymentGatewayConfig.findUnique({
      where: { gateway },
    });
    if (!config) {
      throw new NotFoundException(`No configuration found for ${gateway}.`);
    }
    if (!config.isEnabled) {
      throw new BadRequestException(`${gateway} is currently disabled.`);
    }
    if (!config.credentials) {
      return {};
    }
    try {
      const json = this.crypto.decrypt(config.credentials);
      return JSON.parse(json);
    } catch {
      throw new BadRequestException(
        `Failed to decrypt ${gateway} credentials. They may be corrupted.`,
      );
    }
  }

  /** Load the full config row for a gateway (internal). */
  async getConfigForGateway(gateway: PaymentGateway) {
    const config = await this.prisma.paymentGatewayConfig.findUnique({
      where: { gateway },
    });
    if (!config) {
      throw new NotFoundException(`No configuration found for ${gateway}.`);
    }
    if (!config.isEnabled) {
      throw new BadRequestException(`${gateway} is currently disabled.`);
    }
    return config;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Convert a DB row to a safe shape — credentials are masked, never exposed.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toSafeShape(row: any) {
    let credentialHints: Record<string, string> | null = null;
    let hasCredentials = false;

    if (row.credentials && row.credentials.length > 0) {
      hasCredentials = true;
      try {
        const decrypted = this.crypto.decrypt(row.credentials);
        const parsed = JSON.parse(decrypted);
        // Mask each value — show first few chars + "***"
        credentialHints = {};
        for (const [key, val] of Object.entries(parsed)) {
          const str = String(val);
          credentialHints[key] =
            str.length > 8 ? str.slice(0, 8) + '***' : '••••••';
        }
      } catch {
        credentialHints = { error: 'Could not read credentials' };
      }
    }

    return {
      id: row.id,
      gateway: row.gateway,
      displayName: row.displayName,
      description: row.description,
      logoUrl: row.logoUrl,
      isEnabled: row.isEnabled,
      isDefault: row.isDefault,
      displayOrder: row.displayOrder,
      supportedMethods: Array.isArray(row.supportedMethods)
        ? row.supportedMethods
        : [],
      sandboxMode: row.sandboxMode,
      processingFee: Number(row.processingFee),
      processingFeeType: row.processingFeeType,
      paymentType: row.paymentType,
      instructions: row.instructions,
      webhookUrl: row.webhookUrl,
      credentialHints: credentialHints ? JSON.stringify(credentialHints) : null,
      hasCredentials,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
