import { Module } from '@nestjs/common';
import { SellerService } from './seller.service';
import { SellerResolver } from './seller.resolver';

@Module({
  providers: [SellerResolver, SellerService],
})
export class SellerModule {}
