import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { CouponModule } from '@/modules/ecommerce/coupon/coupon.module';
import { CourierModule } from '@/modules/ecommerce/courier/courier.module';
import { ShippingService } from './shipping.service';
import { ShippingResolver } from './shipping.resolver';

@Module({
  imports: [PrismaModule, CouponModule, CourierModule],
  providers: [ShippingService, ShippingResolver],
  exports: [ShippingService],
})
export class ShippingModule {}
