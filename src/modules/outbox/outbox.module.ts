import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import IORedis from 'ioredis';

import { OutboxCoreModule } from './outbox-core.module';
import { OUTBOX_QUEUE_NAMES } from './outbox.constants';
import { redisClientProvider, RedisHealthIndicator } from './redis.health';
import { OutboxExecutionService } from './outbox-execution.service';
import { OutboxRelayService } from './outbox-relay.service';
import {
  InvoicesProcessor,
  CartProcessor,
  EmailsProcessor,
  CourierProcessor,
} from './outbox.processors';

// Domain modules that own the handler services the processors call. They import
// OutboxCoreModule (@Global) for OutboxService — never OutboxModule — so this
// import direction is one-way and cycle-free.
import { InvoiceModule } from '@/modules/ecommerce/invoice/invoice.module';
import { OrderModule } from '@/modules/ecommerce/order/order.module';
import { PaymentModule } from '@/modules/ecommerce/payment/payment.module';
import { SellerModule } from '@/modules/ecommerce/seller/seller.module';
import { CourierModule } from '@/modules/ecommerce/courier/courier.module';
import { PrivacyModule } from '@/modules/compliance/privacy/privacy.module';
import { NewsletterModule } from '@/modules/cms/newsletter/newsletter.module';
import { ReturnsModule } from '@/modules/ecommerce/returns/returns.module';
import { GrievanceModule } from '@/modules/compliance/grievance/grievance.module';

/**
 * OutboxModule — the CONSUMER half of the durable outbox (P3-01).
 *
 * Wires BullMQ (backed by Redis) + the relay poller + one WorkerHost per named
 * queue + the boot-time Redis health check. The producer half lives in
 * OutboxCoreModule (OutboxService), kept separate to break the domain↔outbox
 * dependency cycle.
 *
 * Register this in AppModule. Redis MUST be reachable at boot — RedisHealthIndicator
 * aborts startup otherwise (the outbox can't drain without it).
 */
@Module({
  imports: [
    OutboxCoreModule,
    // One shared ioredis connection for all BullMQ queues/workers, built from
    // REDIS_URL. `maxRetriesPerRequest: null` is mandatory for BullMQ's blocking
    // commands. ioredis parses rediss:// (TLS) URLs directly.
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: new IORedis(config.getOrThrow<string>('REDIS_URL'), {
          maxRetriesPerRequest: null,
        }),
      }),
    }),
    BullModule.registerQueue(...OUTBOX_QUEUE_NAMES.map((name) => ({ name }))),
    InvoiceModule,
    OrderModule,
    PaymentModule,
    SellerModule,
    // P3-11 courier alert + P3-07 data-export handlers dispatched by the
    // Courier/Emails processors. These modules import OutboxCoreModule (@Global)
    // for OutboxService — never OutboxModule — so the edge stays one-way.
    CourierModule,
    PrivacyModule,
    // P3-08 newsletter double opt-in: EmailsProcessor dispatches the
    // `newsletter.confirm` handler on NewsletterService. NewsletterModule imports
    // OutboxCoreModule (@Global) for OutboxService — never OutboxModule — so the
    // edge stays one-way.
    NewsletterModule,
    // P3-02 returns: EmailsProcessor dispatches the return_* handlers on
    // ReturnsService. ReturnsModule pulls in OutboxCoreModule (@Global) for
    // OutboxService — never OutboxModule — so the edge stays one-way.
    ReturnsModule,
    // P4 (CP-EC grievance): EmailsProcessor dispatches the grievance_* handlers
    // on GrievanceService. GrievanceModule uses the @Global OutboxCoreModule —
    // never OutboxModule — so the edge stays one-way.
    GrievanceModule,
  ],
  providers: [
    redisClientProvider,
    RedisHealthIndicator,
    OutboxExecutionService,
    OutboxRelayService,
    InvoicesProcessor,
    CartProcessor,
    EmailsProcessor,
    CourierProcessor,
  ],
  exports: [RedisHealthIndicator],
})
export class OutboxModule {}
