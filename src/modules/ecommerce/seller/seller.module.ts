import { Module } from '@nestjs/common';
import { EmailModule } from '@/modules/admin/email/email.module';
import { SellerService } from './seller.service';
import { SellerResolver } from './seller.resolver';

@Module({
  imports: [EmailModule],
  providers: [SellerResolver, SellerService],
})
export class SellerModule {}
