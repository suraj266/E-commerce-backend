import { Module } from '@nestjs/common';
import { OrderService } from './order.service';
import { OrderPlacementService } from './order-placement.service';
import { OrderResolver } from './order.resolver';
import { SellerOrderService } from './seller-order.service';
import { SellerOrderResolver } from './seller-order.resolver';
import { EmailModule } from '@/modules/admin/email/email.module';

/**
 * Order module — Phase 5.
 *
 * Three layers:
 *   1. OrderPlacementService     the place-order transaction (heaviest piece)
 *   2. OrderService              customer queries + cancel; delegates to (1)
 *   3. SellerOrderService        seller queries + status transitions
 *
 * Resolvers separate customer-facing and seller-facing GraphQL surfaces.
 * Admin-side oversight is intentionally not exposed here — see
 * ORDER_FLOW.md for the rationale and what comes next.
 */
@Module({
  imports: [EmailModule],
  providers: [
    OrderPlacementService,
    OrderService,
    SellerOrderService,
    OrderResolver,
    SellerOrderResolver,
  ],
  exports: [OrderService, SellerOrderService, OrderPlacementService],
})
export class OrderModule {}
