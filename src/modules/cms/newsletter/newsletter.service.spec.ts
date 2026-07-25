import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { NewsletterStatus, NewsletterCampaignStatus } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { EmailService } from '@/modules/admin/email/email.service';
import { OutboxService } from '@/modules/outbox/outbox.service';
import { PrivacyService } from '@/modules/compliance/privacy/privacy.service';
import { NewsletterService } from './newsletter.service';

/**
 * Wave-4 review #1: the DPDP marketing-consent gate must be re-checked at
 * DELIVERY time, not only at dispatch — a user who withdraws marketing consent
 * during the dispatch→deliver window stays ACTIVE in the newsletter table, so
 * deliverCampaignEmail must fail-closed via canMarket and NOT send.
 */
describe('NewsletterService.deliverCampaignEmail — delivery-time consent gate', () => {
  let service: NewsletterService;
  let prisma: DeepMockProxy<PrismaService>;
  let email: DeepMockProxy<EmailService>;
  let outbox: DeepMockProxy<OutboxService>;
  let privacy: DeepMockProxy<PrivacyService>;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    email = mockDeep<EmailService>();
    outbox = mockDeep<OutboxService>();
    privacy = mockDeep<PrivacyService>();
    service = new NewsletterService(
      prisma as unknown as PrismaService,
      email as unknown as EmailService,
      outbox as unknown as OutboxService,
      privacy as unknown as PrivacyService,
    );

    prisma.newsletterCampaign.findUnique.mockResolvedValue({
      id: 'camp-1',
      subject: 'Hi',
      htmlBody: '<p>Hi</p>',
      status: NewsletterCampaignStatus.SENDING,
    } as never);
    prisma.newsletterSubscription.findUnique.mockResolvedValue({
      id: 'sub-1',
      email: 'u@test',
      status: NewsletterStatus.ACTIVE,
      unsubscribeToken: 'tok',
    } as never);
  });

  it('does NOT send to a registered user who revoked marketing consent after dispatch', async () => {
    // Still ACTIVE in the newsletter table, but consent withdrawn → a registered
    // user whose canMarket is now false.
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1' } as never);
    privacy.canMarket.mockResolvedValue(false);

    await service.deliverCampaignEmail('camp-1', 'sub-1');

    expect(email.send).not.toHaveBeenCalled();
    // Marked SKIPPED (markRecipient uses updateMany).
    expect(
      prisma.newsletterCampaignRecipient.updateMany,
    ).toHaveBeenCalled();
  });

  it('sends when the recipient is still marketable', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1' } as never);
    privacy.canMarket.mockResolvedValue(true);
    prisma.newsletterCampaignRecipient.findUnique.mockResolvedValue(
      null as never,
    );
    email.send.mockResolvedValue({ sent: true } as never);

    await service.deliverCampaignEmail('camp-1', 'sub-1');

    expect(email.send).toHaveBeenCalledTimes(1);
  });
});
