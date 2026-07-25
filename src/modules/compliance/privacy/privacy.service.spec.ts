import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import {
  AccountDeletionStatus,
  ConsentPurpose,
  DataExportStatus,
  NewsletterStatus,
} from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/prisma/prisma.service';
import { EmailService } from '@/modules/admin/email/email.service';
import { OutboxService } from '@/modules/outbox/outbox.service';
import { UserService } from '@/modules/identity/user/user.service';
import { AuthService } from '@/modules/identity/auth/auth.service';
import { PrivacyService } from './privacy.service';
import { PrivacyExportStorageService } from './privacy-export-storage.service';
import { PRIVACY_OUTBOX_EVENT } from './privacy.constants';

/**
 * PrivacyService unit tests (P3-07). Covers the fail-closed consent gate, the
 * durable export enqueue, the erasure grace/cancel lifecycle, and the
 * IRREVERSIBLE anonymization scrub (dry-run + real + idempotent re-run).
 */
describe('PrivacyService', () => {
  let service: PrivacyService;
  let prisma: DeepMockProxy<PrismaService>;
  let outbox: DeepMockProxy<OutboxService>;
  let email: DeepMockProxy<EmailService>;
  let userService: DeepMockProxy<UserService>;
  let authService: DeepMockProxy<AuthService>;
  let exportStorage: DeepMockProxy<PrivacyExportStorageService>;
  let config: DeepMockProxy<ConfigService>;

  const USER_ID = 'user-1';

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    outbox = mockDeep<OutboxService>();
    email = mockDeep<EmailService>();
    userService = mockDeep<UserService>();
    authService = mockDeep<AuthService>();
    exportStorage = mockDeep<PrivacyExportStorageService>();
    config = mockDeep<ConfigService>();

    service = new PrivacyService(
      prisma as unknown as PrismaService,
      outbox as unknown as OutboxService,
      email as unknown as EmailService,
      userService as unknown as UserService,
      authService as unknown as AuthService,
      exportStorage as unknown as PrivacyExportStorageService,
      config as unknown as ConfigService,
    );

    // $transaction: array form → Promise.all; callback form → run with the
    // same deep-mocked client as `tx`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma.$transaction.mockImplementation(((arg: any) =>
      Array.isArray(arg) ? Promise.all(arg) : arg(prisma)) as never);

    // Default: dry-run OFF unless a test overrides.
    config.get.mockReturnValue('false' as never);
  });

  // ---------------------------------------------------------------------------
  // Consent
  // ---------------------------------------------------------------------------
  describe('canMarket (fail-closed)', () => {
    it('returns false when there is NO consent record', async () => {
      prisma.consentRecord.findFirst.mockResolvedValue(null as never);
      await expect(service.canMarket(USER_ID)).resolves.toBe(false);
    });

    it('returns the latest granted state', async () => {
      prisma.consentRecord.findFirst.mockResolvedValue({
        granted: true,
      } as never);
      await expect(service.canMarket(USER_ID)).resolves.toBe(true);
    });

    it('returns false when the latest decision withdrew consent', async () => {
      prisma.consentRecord.findFirst.mockResolvedValue({
        granted: false,
      } as never);
      await expect(service.canMarket(USER_ID)).resolves.toBe(false);
    });
  });

  describe('recordConsent', () => {
    it('appends an immutable consent row (no update path)', async () => {
      prisma.consentRecord.create.mockResolvedValue({ id: 'c1' } as never);
      await service.updateMarketingConsent(USER_ID, true);
      expect(prisma.consentRecord.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: USER_ID,
          purpose: ConsentPurpose.MARKETING_EMAIL,
          granted: true,
        }),
      });
      expect(prisma.consentRecord.update).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Data export
  // ---------------------------------------------------------------------------
  describe('requestExport', () => {
    it('creates a PENDING request and enqueues the outbox job in the SAME tx', async () => {
      prisma.dataExportRequest.create.mockResolvedValue({
        id: 'exp-1',
        status: DataExportStatus.PENDING,
      } as never);

      await service.requestExport(USER_ID);

      // Assert identity of the tx client (gotcha #7 — do NOT use
      // expect.anything() for a jest-mock-extended proxy).
      expect(outbox.enqueue).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({
          type: PRIVACY_OUTBOX_EVENT.DATA_EXPORT,
          queue: 'emails',
          payload: { exportRequestId: 'exp-1' },
          dedupeKey: 'privacy:data_export:exp-1',
        }),
      );
    });
  });

  describe('buildAndSendDataExport', () => {
    beforeEach(() => {
      prisma.order.findMany.mockResolvedValue([] as never);
      prisma.consentRecord.findMany.mockResolvedValue([] as never);
      prisma.newsletterSubscription.findUnique.mockResolvedValue(null as never);
      exportStorage.putBundle.mockResolvedValue({
        fileUrl: 'https://signed.example/exp-1.json',
        expiresAt: new Date(Date.now() + 3600_000),
      } as never);
    });

    it('assembles + stores the bundle, emails the link, and marks READY', async () => {
      prisma.dataExportRequest.findUnique.mockResolvedValue({
        id: 'exp-1',
        userId: USER_ID,
        status: DataExportStatus.PENDING,
      } as never);
      // assembleExportBundle's user read (include addresses/Customer).
      prisma.user.findUnique
        .mockResolvedValueOnce({
          id: USER_ID,
          name: 'Alice',
          email: 'alice@test',
          addresses: [],
          Customer: null,
        } as never)
        // recipient read (select email/name).
        .mockResolvedValueOnce({ email: 'alice@test', name: 'Alice' } as never);
      email.send.mockResolvedValue({ sent: true } as never);

      await service.buildAndSendDataExport('exp-1');

      expect(exportStorage.putBundle).toHaveBeenCalled();
      expect(email.send).toHaveBeenCalledWith(
        'data_export_ready',
        'alice@test',
        expect.objectContaining({ downloadLink: 'https://signed.example/exp-1.json' }),
      );
      expect(prisma.dataExportRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'exp-1' },
          data: expect.objectContaining({ status: DataExportStatus.READY }),
        }),
      );
    });

    it('is idempotent — a READY request is a no-op', async () => {
      prisma.dataExportRequest.findUnique.mockResolvedValue({
        id: 'exp-1',
        userId: USER_ID,
        status: DataExportStatus.READY,
      } as never);
      await service.buildAndSendDataExport('exp-1');
      expect(exportStorage.putBundle).not.toHaveBeenCalled();
      expect(email.send).not.toHaveBeenCalled();
    });

    it('throws on a hard email failure so the outbox retries (not yet READY)', async () => {
      prisma.dataExportRequest.findUnique.mockResolvedValue({
        id: 'exp-1',
        userId: USER_ID,
        status: DataExportStatus.PENDING,
      } as never);
      prisma.user.findUnique
        .mockResolvedValueOnce({
          id: USER_ID,
          name: 'Alice',
          email: 'alice@test',
          addresses: [],
          Customer: null,
        } as never)
        .mockResolvedValueOnce({ email: 'alice@test', name: 'Alice' } as never);
      email.send.mockResolvedValue({ sent: false, message: 'smtp down' } as never);

      await expect(service.buildAndSendDataExport('exp-1')).rejects.toThrow(
        /data_export_ready email failed/,
      );
      // Must NOT have finalized to READY.
      const readyCall = prisma.dataExportRequest.update.mock.calls.find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (c: any) => c[0]?.data?.status === DataExportStatus.READY,
      );
      expect(readyCall).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Erasure lifecycle
  // ---------------------------------------------------------------------------
  describe('requestDeletion', () => {
    it('opens a GRACE request ~30 days out when none is active', async () => {
      prisma.accountDeletionRequest.findFirst.mockResolvedValue(null as never);
      prisma.accountDeletionRequest.create.mockResolvedValue({
        id: 'del-1',
      } as never);

      await service.requestDeletion(USER_ID);

      const arg = prisma.accountDeletionRequest.create.mock.calls[0][0] as {
        data: { status: AccountDeletionStatus; executeAfter: Date };
      };
      expect(arg.data.status).toBe(AccountDeletionStatus.GRACE);
      const days =
        (arg.data.executeAfter.getTime() - Date.now()) / (24 * 3600 * 1000);
      expect(days).toBeGreaterThan(29);
      expect(days).toBeLessThan(31);
    });

    it('is idempotent — returns an existing active request', async () => {
      prisma.accountDeletionRequest.findFirst.mockResolvedValue({
        id: 'del-existing',
        status: AccountDeletionStatus.GRACE,
      } as never);
      const res = await service.requestDeletion(USER_ID);
      expect(res).toMatchObject({ id: 'del-existing' });
      expect(prisma.accountDeletionRequest.create).not.toHaveBeenCalled();
    });
  });

  describe('cancelDeletion', () => {
    it('conditionally flips an active GRACE request to CANCELLED (guarded on GRACE)', async () => {
      prisma.accountDeletionRequest.findFirst.mockResolvedValue({
        id: 'del-1',
        status: AccountDeletionStatus.GRACE,
      } as never);
      // Won the race — the conditional updateMany hit the still-GRACE row.
      prisma.accountDeletionRequest.updateMany.mockResolvedValue({
        count: 1,
      } as never);
      prisma.accountDeletionRequest.findUnique.mockResolvedValue({
        id: 'del-1',
        status: AccountDeletionStatus.CANCELLED,
      } as never);

      const res = await service.cancelDeletion(USER_ID);

      expect(prisma.accountDeletionRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'del-1',
            status: AccountDeletionStatus.GRACE,
          }),
          data: expect.objectContaining({
            status: AccountDeletionStatus.CANCELLED,
          }),
        }),
      );
      expect((res as { status: AccountDeletionStatus }).status).toBe(
        AccountDeletionStatus.CANCELLED,
      );
    });

    it('refuses to cancel once the erasure already executed (claim won the race)', async () => {
      prisma.accountDeletionRequest.findFirst.mockResolvedValue({
        id: 'del-1',
        status: AccountDeletionStatus.GRACE,
      } as never);
      // Lost the race — the row is no longer GRACE, so 0 rows updated.
      prisma.accountDeletionRequest.updateMany.mockResolvedValue({
        count: 0,
      } as never);
      prisma.accountDeletionRequest.findUnique.mockResolvedValue({
        id: 'del-1',
        status: AccountDeletionStatus.ANONYMIZED,
      } as never);

      const res = await service.cancelDeletion(USER_ID);

      // Does NOT clobber the terminal ANONYMIZED state back to CANCELLED.
      expect((res as { status: AccountDeletionStatus }).status).toBe(
        AccountDeletionStatus.ANONYMIZED,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Anonymization scrub
  // ---------------------------------------------------------------------------
  describe('anonymizeUser', () => {
    function stubUser(overrides: Record<string, unknown> = {}) {
      prisma.user.findUnique.mockResolvedValue({
        id: USER_ID,
        email: 'bob@test',
        status: 'active',
        addresses: [{ id: 'a1' }],
        ...overrides,
      } as never);
    }

    it('DRY-RUN writes nothing — no scrub, no session revoke', async () => {
      config.get.mockReturnValue('true' as never); // dry-run enabled
      stubUser();

      const plan = await service.anonymizeUser(USER_ID);

      expect(plan.dryRun).toBe(true);
      expect(plan.scrubbed).toBe(false);
      expect(userService.anonymizePii).not.toHaveBeenCalled();
      expect(authService.revokeAllSessions).not.toHaveBeenCalled();
      expect(prisma.accountDeletionRequest.updateMany).not.toHaveBeenCalled();
    });

    it('real run (winning the GRACE claim) scrubs PII, revokes sessions, unsubscribes, marks ANONYMIZED', async () => {
      stubUser();
      // Won the atomic claim out of GRACE → the scrub proceeds.
      prisma.accountDeletionRequest.updateMany.mockResolvedValue({
        count: 1,
      } as never);
      prisma.newsletterSubscription.findUnique.mockResolvedValue({
        email: 'bob@test',
        status: NewsletterStatus.ACTIVE,
      } as never);

      const plan = await service.anonymizeUser(USER_ID, { dryRun: false });

      expect(plan.scrubbed).toBe(true);
      // Scrub + revoke now run on the claim's tx (=== the mocked prisma). Assert
      // the tx identity, not expect.anything() (a jest-mock-extended deep-mock
      // proxy is mis-read by anything() — see the outbox specs).
      expect(userService.anonymizePii).toHaveBeenCalledWith(USER_ID, prisma);
      expect(authService.revokeAllSessions).toHaveBeenCalledWith(USER_ID, prisma);
      expect(prisma.newsletterSubscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { email: 'bob@test' },
          data: expect.objectContaining({
            status: NewsletterStatus.UNSUBSCRIBED,
          }),
        }),
      );
      // The claim conditionally flips GRACE -> ANONYMIZED.
      expect(prisma.accountDeletionRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: USER_ID,
            status: AccountDeletionStatus.GRACE,
          }),
          data: expect.objectContaining({
            status: AccountDeletionStatus.ANONYMIZED,
          }),
        }),
      );
    });

    it('a concurrently-cancelled erasure (claim matches 0 rows) is NEVER scrubbed', async () => {
      // User is still fully active (not anonymized), but the request was
      // CANCELLED between the cron snapshot and this claim → updateMany hits 0
      // rows. The irreversible scrub MUST NOT run. (Regression: DPDP high finding.)
      stubUser();
      prisma.accountDeletionRequest.updateMany.mockResolvedValue({
        count: 0,
      } as never);

      const plan = await service.anonymizeUser(USER_ID, { dryRun: false });

      expect(plan.scrubbed).toBe(false);
      expect(plan.reason).toBe('no-active-request');
      expect(userService.anonymizePii).not.toHaveBeenCalled();
      expect(authService.revokeAllSessions).not.toHaveBeenCalled();
      expect(prisma.newsletterSubscription.update).not.toHaveBeenCalled();
    });

    it('idempotent re-run does NOT re-scrub an already-anonymized user', async () => {
      stubUser({
        email: `deleted+${USER_ID}@anonymized.invalid`,
        status: 'anonymized',
      });
      // No GRACE row remains (already ANONYMIZED) → claim matches 0.
      prisma.accountDeletionRequest.updateMany.mockResolvedValue({
        count: 0,
      } as never);

      const plan = await service.anonymizeUser(USER_ID, { dryRun: false });

      expect(plan.scrubbed).toBe(false);
      expect(plan.reason).toBe('already-anonymized');
      expect(userService.anonymizePii).not.toHaveBeenCalled();
      expect(authService.revokeAllSessions).not.toHaveBeenCalled();
    });

    it('skips cleanly when the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null as never);
      const plan = await service.anonymizeUser(USER_ID, { dryRun: false });
      expect(plan.reason).toBe('user-not-found');
      expect(userService.anonymizePii).not.toHaveBeenCalled();
    });
  });
});
