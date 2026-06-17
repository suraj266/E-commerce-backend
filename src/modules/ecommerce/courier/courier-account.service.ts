/**
 * Per-seller courier account lifecycle: encrypted credentials, the cached auth
 * token (lazy refresh — Shiprocket tokens have no refresh endpoint, so we
 * re-login when near expiry), and pickup-location registration.
 *
 * Token persistence lives here (single place); providers stay stateless and
 * receive a ready CourierContext via `getValidContext`.
 */

import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CourierAccount, CourierProvider } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { CryptoService } from '@/common/crypto/crypto.service';
import {
  COURIER_PROVIDER_MAP,
  CourierContext,
  ICourierProvider,
} from './providers/courier-provider.interface';
import { TOKEN_REFRESH_SKEW_MS } from './courier.constants';
import { ConnectCourierAccountInput } from './dto/connect-courier-account.input';

@Injectable()
export class CourierAccountService {
  private readonly logger = new Logger(CourierAccountService.name);
  /** Coalesces concurrent re-logins for the same account (avoids login storms). */
  private readonly inflightLogins = new Map<string, Promise<string>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
    @Inject(COURIER_PROVIDER_MAP)
    private readonly providers: Map<string, ICourierProvider>,
  ) {}

  getProvider(provider: CourierProvider): ICourierProvider {
    const p = this.providers.get(provider);
    if (!p) throw new BadRequestException(`Courier provider ${provider} is not available.`);
    if (provider === 'MOCK' && this.config.get('COURIER_ALLOW_MOCK') !== 'true') {
      throw new BadRequestException('The MOCK courier provider is disabled (set COURIER_ALLOW_MOCK=true).');
    }
    return p;
  }

  private async getSellerId(userId: string): Promise<string> {
    const seller = await this.prisma.seller.findUnique({ where: { userId } });
    if (!seller || seller.deletedAt) {
      throw new ForbiddenException('You must complete seller onboarding first.');
    }
    return seller.id;
  }

  // ---------------------------------------------------------------------------
  // Account CRUD (seller-managed)
  // ---------------------------------------------------------------------------

  async connect(userId: string, input: ConnectCourierAccountInput): Promise<CourierAccount> {
    const sellerId = await this.getSellerId(userId);
    const provider = this.getProvider(input.provider);

    const credentials = this.crypto.encrypt(JSON.stringify(input.credentials ?? {}));

    const existing = await this.prisma.courierAccount.findFirst({
      where: { sellerId, provider: input.provider, storeId: null, deletedAt: null },
    });
    const baseData = {
      credentials,
      webhookSecret: input.webhookSecret ?? undefined,
      status: 'PENDING' as const,
      isEnabled: false,
      lastError: null,
      encryptedToken: null,
      tokenExpiresAt: null,
    };
    const account = existing
      ? await this.prisma.courierAccount.update({ where: { id: existing.id }, data: baseData })
      : await this.prisma.courierAccount.create({
          data: { sellerId, provider: input.provider, ...baseData },
        });

    // Validate immediately by minting a token; only enable on success.
    try {
      const login = await provider.login(input.credentials ?? {});
      const encToken = this.crypto.encrypt(login.token);
      return await this.prisma.courierAccount.update({
        where: { id: account.id },
        data: {
          status: 'CONNECTED',
          isEnabled: true,
          encryptedToken: encToken,
          tokenExpiresAt: login.expiresAt,
          lastTestedAt: new Date(),
          lastError: null,
        },
      });
    } catch (e) {
      return this.prisma.courierAccount.update({
        where: { id: account.id },
        data: { status: 'ERROR', isEnabled: false, lastError: (e as Error).message, lastTestedAt: new Date() },
      });
    }
  }

  async test(userId: string, provider: CourierProvider): Promise<CourierAccount> {
    const sellerId = await this.getSellerId(userId);
    const account = await this.requireAccount(sellerId, provider);
    const impl = this.getProvider(provider);
    const credentials = JSON.parse(this.crypto.decrypt(account.credentials || '{}'));
    try {
      const login = await impl.login(credentials);
      return this.prisma.courierAccount.update({
        where: { id: account.id },
        data: {
          status: 'CONNECTED',
          encryptedToken: this.crypto.encrypt(login.token),
          tokenExpiresAt: login.expiresAt,
          lastTestedAt: new Date(),
          lastError: null,
        },
      });
    } catch (e) {
      return this.prisma.courierAccount.update({
        where: { id: account.id },
        data: { status: 'ERROR', lastError: (e as Error).message, lastTestedAt: new Date() },
      });
    }
  }

  /** Store the webhook token the seller configured in their courier panel. */
  async setWebhookSecret(
    userId: string,
    provider: CourierProvider,
    secret: string,
  ): Promise<CourierAccount> {
    const sellerId = await this.getSellerId(userId);
    const account = await this.requireAccount(sellerId, provider);
    return this.prisma.courierAccount.update({
      where: { id: account.id },
      data: { webhookSecret: secret.trim() || null },
    });
  }

  /** Select which (already-existing) provider pickup location orders ship from. */
  async setPickupLocation(
    userId: string,
    provider: CourierProvider,
    nickname: string,
  ): Promise<CourierAccount> {
    const sellerId = await this.getSellerId(userId);
    const account = await this.requireAccount(sellerId, provider);
    return this.prisma.courierAccount.update({
      where: { id: account.id },
      data: { pickupLocationNickname: nickname },
    });
  }

  async setEnabled(userId: string, provider: CourierProvider, enabled: boolean): Promise<CourierAccount> {
    const sellerId = await this.getSellerId(userId);
    const account = await this.requireAccount(sellerId, provider);
    return this.prisma.courierAccount.update({
      where: { id: account.id },
      data: { isEnabled: enabled, status: enabled ? 'CONNECTED' : 'DISABLED' },
    });
  }

  async myAccounts(userId: string): Promise<CourierAccount[]> {
    const sellerId = await this.getSellerId(userId);
    return this.prisma.courierAccount.findMany({
      where: { sellerId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Register a warehouse as a pickup location with the seller's courier. */
  async registerPickupLocation(userId: string, provider: CourierProvider, warehouseId: string) {
    const sellerId = await this.getSellerId(userId);
    const account = await this.requireAccount(sellerId, provider);
    const warehouse = await this.prisma.warehouse.findUnique({ where: { id: warehouseId } });
    if (!warehouse || warehouse.deletedAt) throw new NotFoundException('Warehouse not found.');
    // Ownership: warehouse → store → seller.
    const store = await this.prisma.store.findUnique({ where: { id: warehouse.storeId } });
    if (!store || store.sellerId !== sellerId) throw new ForbiddenException('You do not own this warehouse.');

    const impl = this.getProvider(provider);
    const { context } = await this.getValidContext(account.id);
    const nickname = warehouse.code || `wh-${warehouse.id.slice(0, 8)}`;
    const result = await impl.registerPickupLocation(context, {
      nickname,
      name: warehouse.name,
      phone: warehouse.phone ?? '',
      addressLine1: warehouse.addressLine1,
      addressLine2: warehouse.addressLine2,
      city: warehouse.city,
      state: warehouse.state,
      pincode: warehouse.postalCode,
      country: warehouse.countryCode || 'India',
    });
    await this.prisma.warehouse.update({
      where: { id: warehouse.id },
      data: { providerLocationId: result.providerLocationId },
    });
    // Default the account's pickup nickname to this warehouse if unset.
    if (!account.pickupLocationNickname) {
      await this.prisma.courierAccount.update({
        where: { id: account.id },
        data: { pickupLocationNickname: result.nickname, providerLocationId: result.providerLocationId },
      });
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Token lifecycle + context resolution (used by CourierService)
  // ---------------------------------------------------------------------------

  /** The single enabled account for a seller (rate/ship resolution). */
  async getEnabledAccount(sellerId: string): Promise<CourierAccount | null> {
    return this.prisma.courierAccount.findFirst({
      where: { sellerId, isEnabled: true, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findAccountByWebhookSecret(secret: string): Promise<CourierAccount | null> {
    if (!secret) return null;
    return this.prisma.courierAccount.findFirst({ where: { webhookSecret: secret, deletedAt: null } });
  }

  /**
   * Returns a CourierContext with a guaranteed-fresh token. Re-logins (and
   * persists the new token) when the cached one is missing/near expiry, with
   * in-process coalescing so concurrent callers share one login.
   */
  async getValidContext(accountId: string): Promise<{ context: CourierContext; account: CourierAccount }> {
    const account = await this.prisma.courierAccount.findUnique({ where: { id: accountId } });
    if (!account || account.deletedAt) throw new NotFoundException('Courier account not found.');
    const credentials = JSON.parse(this.crypto.decrypt(account.credentials || '{}'));

    const fresh =
      account.encryptedToken &&
      account.tokenExpiresAt &&
      account.tokenExpiresAt.getTime() - Date.now() > TOKEN_REFRESH_SKEW_MS;

    const token = fresh
      ? this.crypto.decrypt(account.encryptedToken as string)
      : await this.refreshToken(account, credentials);

    return {
      account,
      context: {
        credentials,
        token,
        pickupLocationNickname: account.pickupLocationNickname,
      },
    };
  }

  private async refreshToken(account: CourierAccount, credentials: Record<string, unknown>): Promise<string> {
    const existing = this.inflightLogins.get(account.id);
    if (existing) return existing;

    const p = (async () => {
      const impl = this.getProvider(account.provider);
      const login = await impl.login(credentials);
      await this.prisma.courierAccount.update({
        where: { id: account.id },
        data: { encryptedToken: this.crypto.encrypt(login.token), tokenExpiresAt: login.expiresAt },
      });
      return login.token;
    })();
    this.inflightLogins.set(account.id, p);
    try {
      return await p;
    } finally {
      this.inflightLogins.delete(account.id);
    }
  }

  private async requireAccount(sellerId: string, provider: CourierProvider): Promise<CourierAccount> {
    const account = await this.prisma.courierAccount.findFirst({
      where: { sellerId, provider, deletedAt: null },
    });
    if (!account) throw new NotFoundException(`No ${provider} account connected.`);
    return account;
  }

  /** Masked view for GraphQL — never leaks credentials or the token. */
  toSafeShape(a: CourierAccount) {
    return {
      id: a.id,
      provider: a.provider,
      status: a.status,
      isEnabled: a.isEnabled,
      hasCredentials: !!a.credentials,
      pickupLocationNickname: a.pickupLocationNickname,
      webhookConfigured: !!a.webhookSecret,
      lastError: a.lastError,
      lastTestedAt: a.lastTestedAt,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    };
  }
}
