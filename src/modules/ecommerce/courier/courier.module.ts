import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '@/prisma/prisma.module';
import { CryptoService } from '@/common/crypto/crypto.service';
import { OrderModule } from '@/modules/ecommerce/order/order.module';
import { COURIER_PROVIDER_MAP, ICourierProvider } from './providers/courier-provider.interface';
import { ShiprocketProvider } from './providers/shiprocket.provider';
import { MockProvider } from './providers/mock.provider';
import { CourierAccountService } from './courier-account.service';
import { CourierRateCacheService } from './courier-rate-cache.service';
import { CourierService } from './courier.service';
import { CourierStatusCron } from './courier-status.cron';
import { CourierWebhookController } from './courier-webhook.controller';
import { CourierResolver } from './courier.resolver';

/**
 * Multi-provider courier integration. Providers are registered in
 * COURIER_PROVIDER_MAP and dispatched by `CourierAccount.provider`.
 * `CryptoService` is re-provided here (it is NOT global — same
 * PAYMENT_ENCRYPTION_KEY as payments).
 */
@Module({
  imports: [ConfigModule, PrismaModule, forwardRef(() => OrderModule)],
  controllers: [CourierWebhookController],
  providers: [
    CryptoService,
    ShiprocketProvider,
    MockProvider,
    {
      provide: COURIER_PROVIDER_MAP,
      useFactory: (shiprocket: ShiprocketProvider, mock: MockProvider) => {
        const map = new Map<string, ICourierProvider>();
        map.set('SHIPROCKET', shiprocket);
        map.set('MOCK', mock);
        return map;
      },
      inject: [ShiprocketProvider, MockProvider],
    },
    CourierAccountService,
    CourierRateCacheService,
    CourierService,
    CourierStatusCron,
    CourierResolver,
  ],
  exports: [CourierAccountService, CourierService],
})
export class CourierModule {}
