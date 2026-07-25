import { Module } from '@nestjs/common';
import { EmailModule } from '@/modules/admin/email/email.module';
import { SellerService } from './seller.service';
import { SellerResolver } from './seller.resolver';

@Module({
  imports: [EmailModule],
  providers: [SellerResolver, SellerService],
  // Exported so the outbox email worker (OutboxModule) can call the KYC email
  // senders when it processes email.seller_kyc_* events.
  exports: [SellerService],
})
export class SellerModule {}
