import { Test, TestingModule } from '@nestjs/testing';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { BusinessType, SellerStatus } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { EmailService } from '@/modules/admin/email/email.service';
import { OutboxService } from '@/modules/outbox/outbox.service';
import { SellerService } from './seller.service';

// Let the fire-and-forget notifiers (admin alert on submitForReview still awaits
// a scoped user lookup before calling email.send) drain onto the microtask
// queue before we assert.
const flush = () => new Promise((resolve) => setImmediate(resolve));

/** Minimal Seller row shaped enough for the notifier code paths. */
function sellerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'seller-1',
    userId: 'user-1',
    displayName: 'Acme Store',
    legalName: 'Acme Pvt Ltd',
    businessType: BusinessType.INDIVIDUAL,
    businessEmail: 'biz@acme.test',
    // Required by submitForReview()'s completeness check (INDIVIDUAL needs no
    // signatory fields). Present so the DRAFT->PENDING path reaches the email.
    panNumber: 'ABCDE1234F',
    businessPhone: '9876543210',
    gstin: null,
    overallStatus: SellerStatus.PENDING,
    deletedAt: null,
    payoutAccounts: [],
    ...overrides,
  };
}

describe('SellerService — lifecycle emails', () => {
  let service: SellerService;
  let prisma: DeepMockProxy<PrismaService>;
  let email: DeepMockProxy<EmailService>;
  let outbox: DeepMockProxy<OutboxService>;

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    email = mockDeep<EmailService>();
    outbox = mockDeep<OutboxService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [SellerService],
    })
      .useMocker((token) => {
        if (token === PrismaService) return prisma;
        if (token === EmailService) return email;
        if (token === OutboxService) return outbox;
        return mockDeep();
      })
      .compile();

    service = module.get<SellerService>(SellerService);

    // KYC status changes now update the seller AND enqueue the notification
    // OutboxEvent in ONE transaction. Run the callback form against the same
    // deep-mocked client as `tx` so those writes are observable.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma.$transaction.mockImplementation(((arg: any) =>
      Array.isArray(arg) ? Promise.all(arg) : arg(prisma)) as never);

    // Owner lookup used by every seller-facing notifier.
    prisma.user.findUnique.mockResolvedValue({
      email: 'owner@acme.test',
      name: 'Owner Person',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    // Default: one active superAdmin on file.
    prisma.user.findMany.mockResolvedValue([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { email: 'admin@platform.test' } as any,
    ]);
    email.send.mockResolvedValue({ sent: true });
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ---- setStatus → VERIFIED ------------------------------------------------

  it('enqueues seller_kyc_approved when setStatus transitions PENDING → VERIFIED', async () => {
    prisma.seller.findUnique.mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sellerRow({ overallStatus: SellerStatus.PENDING }) as any,
    );
    prisma.seller.update.mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sellerRow({ overallStatus: SellerStatus.VERIFIED }) as any,
    );

    await service.setStatus({ id: 'seller-1', status: SellerStatus.VERIFIED });
    await flush();

    // Durable: enqueued in the status-flip tx, sent by the outbox worker.
    expect(outbox.enqueue).toHaveBeenCalledWith(
      // arg0 is the tx client (=== the mocked prisma inside $transaction). A
      // jest-mock-extended deep-mock proxy is mis-read by expect.anything()
      // (the proxy answers every prop, so jest treats it as an asymmetric
      // matcher). Assert the tx identity directly instead — this also proves
      // the enqueue happened INSIDE the status-flip transaction.
      prisma,
      expect.objectContaining({
        type: 'email.seller_kyc_approved',
        payload: { sellerId: 'seller-1' },
      }),
    );
    // The KYC email is not sent inline anymore.
    expect(email.send).not.toHaveBeenCalled();
  });

  it('does NOT enqueue seller_kyc_approved when already VERIFIED (guard)', async () => {
    prisma.seller.findUnique.mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sellerRow({ overallStatus: SellerStatus.VERIFIED }) as any,
    );
    prisma.seller.update.mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sellerRow({ overallStatus: SellerStatus.VERIFIED }) as any,
    );

    await service.setStatus({ id: 'seller-1', status: SellerStatus.VERIFIED });
    await flush();

    expect(outbox.enqueue).not.toHaveBeenCalled();
    expect(email.send).not.toHaveBeenCalled();
  });

  // ---- setStatus → REJECTED ------------------------------------------------

  it('enqueues seller_kyc_rejected and persists the admin reason', async () => {
    prisma.seller.findUnique.mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sellerRow({ overallStatus: SellerStatus.UNDER_REVIEW }) as any,
    );
    prisma.seller.update.mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sellerRow({ overallStatus: SellerStatus.REJECTED }) as any,
    );

    await service.setStatus({
      id: 'seller-1',
      status: SellerStatus.REJECTED,
      reason: 'PAN blurry',
    });
    await flush();

    // Reason is persisted on the row (the worker reads it back at send time).
    const updateData = prisma.seller.update.mock.calls[0][0] as any;
    expect(updateData.data.rejectionReason).toBe('PAN blurry');
    expect(outbox.enqueue).toHaveBeenCalledWith(
      // arg0 is the tx client (=== the mocked prisma inside $transaction). A
      // jest-mock-extended deep-mock proxy is mis-read by expect.anything()
      // (the proxy answers every prop, so jest treats it as an asymmetric
      // matcher). Assert the tx identity directly instead — this also proves
      // the enqueue happened INSIDE the status-flip transaction.
      prisma,
      expect.objectContaining({
        type: 'email.seller_kyc_rejected',
        payload: { sellerId: 'seller-1' },
      }),
    );
  });

  // ---- submitForReview → admin alert --------------------------------------

  it('sends admin_new_seller to active superAdmins on submitForReview', async () => {
    prisma.seller.findUnique.mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sellerRow({ overallStatus: SellerStatus.DRAFT }) as any,
    );
    prisma.seller.update.mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sellerRow({ overallStatus: SellerStatus.PENDING }) as any,
    );

    await service.submitForReview('user-1', 'seller-1');
    await flush();

    expect(email.send).toHaveBeenCalledWith(
      'admin_new_seller',
      'admin@platform.test',
      expect.objectContaining({
        sellerEmail: 'owner@acme.test',
        businessType: BusinessType.INDIVIDUAL,
      }),
    );
  });

  // ---- durability: setStatus never blocks on the email ---------------------

  it('setStatus resolves to the updated seller even though the email is deferred', async () => {
    prisma.seller.findUnique.mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sellerRow({ overallStatus: SellerStatus.PENDING }) as any,
    );
    const updated = sellerRow({ overallStatus: SellerStatus.VERIFIED });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma.seller.update.mockResolvedValue(updated as any);

    await expect(
      service.setStatus({ id: 'seller-1', status: SellerStatus.VERIFIED }),
    ).resolves.toEqual(updated);

    // The send is durably deferred to the outbox, not attempted inline.
    expect(outbox.enqueue).toHaveBeenCalledTimes(1);
    expect(email.send).not.toHaveBeenCalled();
  });

  // ---- worker send methods (invoked by the outbox email processor) ---------

  it('sendKycApprovedEmail throws on a hard send failure so the outbox retries', async () => {
    prisma.seller.findUnique.mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sellerRow() as any,
    );
    // A non-skipped failure (e.g. SMTP transport error) must propagate.
    email.send.mockResolvedValue({ sent: false, message: 'SMTP down' });

    await expect(service.sendKycApprovedEmail('seller-1')).rejects.toThrow(
      /seller_kyc_approved/,
    );
    expect(email.send).toHaveBeenCalledWith(
      'seller_kyc_approved',
      'owner@acme.test',
      expect.objectContaining({ sellerName: 'Owner Person' }),
    );
  });

  it('sendKycApprovedEmail does NOT throw when the send is intentionally skipped', async () => {
    prisma.seller.findUnique.mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sellerRow() as any,
    );
    // SMTP unconfigured / template disabled → skipped, a no-op (no retry).
    email.send.mockResolvedValue({ sent: false, skipped: true });

    await expect(
      service.sendKycApprovedEmail('seller-1'),
    ).resolves.toBeUndefined();
  });
});
