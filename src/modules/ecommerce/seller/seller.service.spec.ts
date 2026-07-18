import { Test, TestingModule } from '@nestjs/testing';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { BusinessType, SellerStatus } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { EmailService } from '@/modules/admin/email/email.service';
import { SellerService } from './seller.service';

// Let the fire-and-forget notifiers (which await a scoped user lookup before
// calling email.send) drain onto the microtask queue before we assert.
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

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    email = mockDeep<EmailService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [SellerService],
    })
      .useMocker((token) => {
        if (token === PrismaService) return prisma;
        if (token === EmailService) return email;
        return mockDeep();
      })
      .compile();

    service = module.get<SellerService>(SellerService);

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

  it('sends seller_kyc_approved when setStatus transitions PENDING → VERIFIED', async () => {
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

    expect(email.send).toHaveBeenCalledWith(
      'seller_kyc_approved',
      'owner@acme.test',
      expect.objectContaining({ sellerName: 'Owner Person' }),
    );
    // Branding is injected by EmailService — callers must not pass shopName.
    const ctx = email.send.mock.calls[0][2] ?? {};
    expect(ctx).not.toHaveProperty('shopName');
  });

  it('does NOT resend seller_kyc_approved when already VERIFIED (guard)', async () => {
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

    expect(email.send).not.toHaveBeenCalled();
  });

  // ---- setStatus → REJECTED ------------------------------------------------

  it('sends seller_kyc_rejected with the admin reason', async () => {
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

    expect(email.send).toHaveBeenCalledWith(
      'seller_kyc_rejected',
      'owner@acme.test',
      expect.objectContaining({ rejectionReason: 'PAN blurry' }),
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

  // ---- soft-fail -----------------------------------------------------------

  it('soft-fails: a rejected email send never breaks setStatus', async () => {
    prisma.seller.findUnique.mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sellerRow({ overallStatus: SellerStatus.PENDING }) as any,
    );
    const updated = sellerRow({ overallStatus: SellerStatus.VERIFIED });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma.seller.update.mockResolvedValue(updated as any);
    email.send.mockRejectedValue(new Error('SMTP down'));

    await expect(
      service.setStatus({ id: 'seller-1', status: SellerStatus.VERIFIED }),
    ).resolves.toEqual(updated);
    await flush();

    expect(email.send).toHaveBeenCalled();
  });
});
