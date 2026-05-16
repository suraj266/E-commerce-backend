import { Module } from '@nestjs/common';
import { ReviewService } from './review.service';
import { ReviewResolver } from './review.resolver';
import { ReviewAdminResolver } from './review-admin.resolver';
import { ReviewMediaController } from './review-media.controller';
import { EmailModule } from '@/modules/admin/email/email.module';

@Module({
  imports: [EmailModule],
  controllers: [ReviewMediaController],
  providers: [ReviewService, ReviewResolver, ReviewAdminResolver],
  exports: [ReviewService],
})
export class ReviewModule {}
