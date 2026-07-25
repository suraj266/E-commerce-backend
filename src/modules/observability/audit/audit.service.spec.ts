import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { PrismaService } from '@/prisma/prisma.service';
import { AuditService, redactSecrets } from './audit.service';

/**
 * AuditService unit tests — jest-mock-extended style (Phase-3 P3-05).
 * Verifies the best-effort contract (never throws), secret redaction, and the
 * INSERT shape written to the append-only table.
 */
describe('AuditService', () => {
  let service: AuditService;
  let prisma: DeepMockProxy<PrismaService>;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    service = new AuditService(prisma as unknown as PrismaService);
  });

  describe('record', () => {
    it('writes an audit row with the given action/entity/actor', async () => {
      prisma.auditLog.create.mockResolvedValue({ id: 'a1' } as never);

      await service.record({
        action: 'refund.approve',
        entityType: 'Refund',
        entityId: 'refund-1',
        actorUserId: 'admin-1',
        before: { status: 'REQUESTED' },
        after: { status: 'PROCESSING' },
      });

      expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
      const arg = prisma.auditLog.create.mock.calls[0][0] as any;
      expect(arg.data.action).toBe('refund.approve');
      expect(arg.data.entityType).toBe('Refund');
      expect(arg.data.entityId).toBe('refund-1');
      expect(arg.data.actorUserId).toBe('admin-1');
      expect(arg.data.before).toEqual({ status: 'REQUESTED' });
      expect(arg.data.after).toEqual({ status: 'PROCESSING' });
    });

    it('never throws even when the DB write fails (best-effort)', async () => {
      prisma.auditLog.create.mockRejectedValue(new Error('append-only boom'));

      await expect(
        service.record({ action: 'payout.run', entityType: 'Payout' }),
      ).resolves.toBeUndefined();
    });

    it('writes JSON null (not undefined) when a snapshot is explicitly null', async () => {
      prisma.auditLog.create.mockResolvedValue({ id: 'a1' } as never);

      await service.record({
        action: 'payout.run',
        entityType: 'Payout',
        before: null,
        after: { status: 'PROCESSING' },
      });

      const arg = prisma.auditLog.create.mock.calls[0][0] as any;
      // Prisma.JsonNull sentinel, not the JS undefined that would omit the col.
      expect(arg.data.before).not.toBeUndefined();
    });
  });

  describe('redactSecrets', () => {
    it('replaces secret-bearing keys with *** at any depth', () => {
      const out = redactSecrets({
        gateway: 'RAZORPAY',
        credentials: 'enc:abc123',
        nested: { apiKey: 'k_live_x', keySecret: 's_x', displayName: 'ok' },
      }) as any;

      expect(out.gateway).toBe('RAZORPAY');
      expect(out.credentials).toBe('***');
      expect(out.nested.apiKey).toBe('***');
      expect(out.nested.keySecret).toBe('***');
      expect(out.nested.displayName).toBe('ok');
    });

    it('passes through primitives and null unchanged', () => {
      expect(redactSecrets(null)).toBeNull();
      expect(redactSecrets('x')).toBe('x');
      expect(redactSecrets(42)).toBe(42);
    });
  });

  describe('list', () => {
    it('serialises before/after to JSON strings and paginates', async () => {
      prisma.$transaction.mockResolvedValue([
        [
          {
            id: 'a1',
            actorUserId: 'admin-1',
            actorEmail: null,
            action: 'refund.approve',
            entityType: 'Refund',
            entityId: 'refund-1',
            before: { status: 'REQUESTED' },
            after: { status: 'PROCESSED' },
            ip: null,
            userAgent: null,
            requestId: 'req-1',
            createdAt: new Date('2026-07-18T00:00:00Z'),
          },
        ],
        1,
      ] as never);

      const res = await service.list({ entityType: 'Refund', pageSize: 10 });
      expect(res.totalCount).toBe(1);
      expect(res.items[0].before).toBe('{"status":"REQUESTED"}');
      expect(res.items[0].after).toBe('{"status":"PROCESSED"}');
    });
  });
});
