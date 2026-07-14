/**
 * PaymentModule — multi-gateway payment system.
 *
 * Architecture:
 *   - PAYMENT_GATEWAY_MAP: Map<string, IPaymentGateway> — all registered
 *     gateways. The checkout service picks the right one per order.
 *   - PaymentConfigService: admin CRUD for gateway configs (credentials
 *     encrypted in DB).
 *   - PaymentService: checkout orchestrator (two-phase flow).
 *   - PaymentWebhookController: REST endpoints for gateway callbacks.
 *
 * Adding a new gateway:
 *   1. Create `my-gateway.gateway.ts` implementing IPaymentGateway
 *   2. Add it to the factory below
 *   3. Add a webhook route in PaymentWebhookController
 *   4. Add the enum value to PaymentGateway in Prisma
 *   5. Admin configures credentials via the Payment Methods page
 */

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { OrderModule } from '../order/order.module';
import { InvoiceModule } from '../invoice/invoice.module';

// Crypto
import { CryptoService } from '@/common/crypto/crypto.service';

// Gateways
import { CodGateway } from './gateways/cod.gateway';
import { RazorpayGateway } from './gateways/razorpay.gateway';
import {
  PAYMENT_GATEWAY_MAP,
  type IPaymentGateway,
} from './gateways/payment-gateway.interface';

// Services
import { PaymentConfigService } from './payment-config.service';
import { PaymentService } from './payment.service';

// Resolvers + Controller
import { PaymentResolver } from './payment.resolver';
import { PaymentAdminResolver } from './payment-admin.resolver';
import { PaymentWebhookController } from './payment-webhook.controller';
import { PaymentReconciliationCron } from './payment-reconciliation.cron';

@Module({
  imports: [ConfigModule, OrderModule, InvoiceModule],
  controllers: [PaymentWebhookController],
  providers: [
    CryptoService,
    CodGateway,
    RazorpayGateway,
    {
      provide: PAYMENT_GATEWAY_MAP,
      useFactory: (
        cod: CodGateway,
        razorpay: RazorpayGateway,
      ): Map<string, IPaymentGateway> => {
        const map = new Map<string, IPaymentGateway>();
        map.set('COD', cod);
        map.set('RAZORPAY', razorpay);
        // Future: map.set('STRIPE', stripe);
        // Future: map.set('PHONEPE', phonepe);
        return map;
      },
      inject: [CodGateway, RazorpayGateway],
    },
    PaymentConfigService,
    PaymentService,
    PaymentResolver,
    PaymentAdminResolver,
    PaymentReconciliationCron,
  ],
  exports: [PaymentService, PaymentConfigService],
})
export class PaymentModule {}
