import { Global, Module } from '@nestjs/common';
import { OutboxService } from './outbox.service';

/**
 * OutboxCoreModule — the PRODUCER half of the outbox, in its own tiny module.
 *
 * It provides only `OutboxService.enqueue` and has NO domain dependencies, so
 * the business modules that enqueue (order/payment/refund/seller) can inject it
 * freely. The CONSUMER half (`OutboxModule`: relay + BullMQ workers) imports
 * those same domain modules — keeping the producer separate is what breaks the
 * otherwise-circular dependency (domain → outbox → domain).
 *
 * `@Global` so any provider can inject `OutboxService` without wiring an import
 * into every module — it's a cross-cutting concern, like PrismaModule.
 */
@Global()
@Module({
  providers: [OutboxService],
  exports: [OutboxService],
})
export class OutboxCoreModule {}
