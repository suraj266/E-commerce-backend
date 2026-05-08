import { Module } from '@nestjs/common';
import { NewsletterService } from './newsletter.service';
import { NewsletterResolver } from './newsletter.resolver';

@Module({
  providers: [NewsletterService, NewsletterResolver],
  exports: [NewsletterService],
})
export class NewsletterModule {}
