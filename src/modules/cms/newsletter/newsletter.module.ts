import { Module } from '@nestjs/common';
import { EmailModule } from '@/modules/admin/email/email.module';
import { PrivacyModule } from '@/modules/compliance/privacy/privacy.module';
import { NewsletterService } from './newsletter.service';
import { NewsletterResolver } from './newsletter.resolver';
import { NewsletterCampaignResolver } from './newsletter-campaign.resolver';

/**
 * NewsletterModule (P3-08 double opt-in).
 *
 * Wiring notes:
 *   - EmailModule   → EmailService (the confirmation email).
 *   - PrivacyModule → PrivacyService (the marketing-consent gate,
 *     filterMarketableRecipients / WIRE-CONSENT).
 *   - OutboxService (@Global, OutboxCoreModule) is injected without an import —
 *     the confirm email is enqueued durably on subscribe.
 *
 * NewsletterService is exported so the central outbox EmailsProcessor can inject
 * it to run the `newsletter.confirm` handler (OutboxModule imports this module).
 */
@Module({
  imports: [EmailModule, PrivacyModule],
  providers: [
    NewsletterService,
    NewsletterResolver,
    NewsletterCampaignResolver,
  ],
  exports: [NewsletterService],
})
export class NewsletterModule {}
