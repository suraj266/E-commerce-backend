/**
 * Daily tracking backstop: for SHIPPED-but-not-delivered orders shipped via a
 * courier, poll the provider's tracking API and apply any status advance. This
 * covers missed/failed webhooks. Idempotent — applyStatus only moves forward.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OrderStatus } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { CourierAccountService } from './courier-account.service';
import { CourierService } from './courier.service';

@Injectable()
export class CourierStatusCron {
  private readonly logger = new Logger(CourierStatusCron.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: CourierAccountService,
    private readonly courier: CourierService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async poll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const orders = await this.prisma.sellerOrder.findMany({
        where: {
          status: OrderStatus.SHIPPED,
          deletedAt: null,
          awbCode: { not: null },
          shippingProvider: { not: null },
        },
        select: { id: true, sellerId: true, awbCode: true, shippingProvider: true },
        take: 500,
      });
      for (const o of orders) {
        try {
          const account = await this.accounts.getEnabledAccount(o.sellerId);
          if (!account || account.provider !== o.shippingProvider) continue;
          const impl = this.accounts.getProvider(account.provider);
          const { context } = await this.accounts.getValidContext(account.id);
          const t = await impl.track(context, o.awbCode as string);
          const status = impl.normalizeStatus(t.providerStatusCode);
          await this.courier.applyStatus(o.id, status, t.providerStatus || 'tracking poll');
        } catch (e) {
          this.logger.warn(`Tracking poll failed for ${o.id}: ${(e as Error).message}`);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
