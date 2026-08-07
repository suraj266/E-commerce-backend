import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GrievanceCategory, GrievanceStatus } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { EmailService } from '@/modules/admin/email/email.service';
import { OutboxService } from '@/modules/outbox/outbox.service';
import { GrievanceService } from './grievance.service';

/**
 * GrievanceService unit tests — jest-mock-extended, same style as
 * returns.service.spec.ts. Covers filing (ticket + SLA + outbox), the ownership
 * guard, an illegal state transition, SLA-breach escalation (guarded flip), and
 * the monthly compliance report roll-up.
 *
 * TEST GOTCHA (rule 4): the tx-passed mock arg is asserted by identity
 * (`prisma`), never expect.anything() — a jest-mock-extended deep proxy answers
 * every property so expect.anything() mis-reads it as a matcher.
 */
describe('GrievanceService', () => {
  let service: GrievanceService;
  let prisma: DeepMockProxy<PrismaService>;
  let outbox: DeepMockProxy<OutboxService>;
  let email: DeepMockProxy<EmailService>;
  let config: { get: jest.Mock };
  let notifications: { create: jest.Mock };

  const USER = 'user-1';

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    outbox = mockDeep<OutboxService>();
    email = mockDeep<EmailService>();
    config = { get: jest.fn().mockReturnValue(undefined) };
    notifications = { create: jest.fn() };

    service = new GrievanceService(
      prisma as unknown as PrismaService,
      outbox as unknown as OutboxService,
      email as unknown as EmailService,
      config as unknown as ConfigService,
      notifications as never,
    );

    // $transaction: array → Promise.all; callback → run against the mock client.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma.$transaction.mockImplementation(((arg: any) =>
      Array.isArray(arg) ? Promise.all(arg) : arg(prisma)) as never);
  });

  // ---------------------------------------------------------------------------
  // fileGrievance
  // ---------------------------------------------------------------------------

  describe('fileGrievance', () => {
    it('creates an OPEN ticket, sets an SLA, and enqueues the acknowledgement', async () => {
      const now = new Date();
      const future = new Date(Date.now() + 72 * 60 * 60 * 1000);
      prisma.grievance.create.mockResolvedValue({
        id: 'g-1',
        ticketNumber: 'GRV-2026-07-ABCDEFG',
        raisedByUserId: USER,
        contactName: null,
        contactEmail: null,
        orderId: null,
        sellerOrderId: null,
        category: GrievanceCategory.DELIVERY,
        subject: 'Parcel not delivered',
        description: 'It never arrived.',
        status: GrievanceStatus.OPEN,
        priority: 'NORMAL',
        slaDueAt: future,
        assignedToUserId: null,
        resolutionNote: null,
        firstResponseAt: null,
        escalatedAt: null,
        resolvedAt: null,
        closedAt: null,
        createdAt: now,
        updatedAt: now,
        messages: [],
      } as never);

      const res = await service.fileGrievance(USER, {
        category: GrievanceCategory.DELIVERY,
        subject: 'Parcel not delivered',
        description: 'It never arrived.',
      });

      expect(res).toMatchObject({ id: 'g-1', slaBreached: false });
      expect(prisma.grievance.create).toHaveBeenCalledTimes(1);

      // The initial thread message is the customer's description.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const createArg = prisma.grievance.create.mock.calls[0][0] as any;
      expect(createArg.data.status).toBe(GrievanceStatus.OPEN);
      expect(createArg.data.slaDueAt).toBeInstanceOf(Date);
      expect(createArg.data.messages.create.authorRole).toBe('CUSTOMER');

      // Acknowledgement enqueued in-tx (tx === prisma mock; assert by identity).
      expect(outbox.enqueue).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({ type: 'email.grievance_filed' }),
      );
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'grievance_filed' }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Ownership + transition guards
  // ---------------------------------------------------------------------------

  describe('guards', () => {
    it('myGrievanceDetail refuses another user’s complaint', async () => {
      prisma.grievance.findUnique.mockResolvedValue({
        id: 'g-1',
        raisedByUserId: 'someone-else',
        messages: [],
      } as never);

      await expect(
        service.myGrievanceDetail(USER, 'g-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('resolveGrievance rejects an illegal transition from CLOSED', async () => {
      prisma.grievance.findUnique.mockResolvedValue({
        id: 'g-1',
        status: GrievanceStatus.CLOSED,
      } as never);

      await expect(
        service.resolveGrievance(USER, {
          grievanceId: 'g-1',
          resolutionNote: 'done',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.grievance.updateMany).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // replyToGrievance (Phase-4 review fixes)
  // ---------------------------------------------------------------------------

  describe('replyToGrievance', () => {
    it('rejects an empty/whitespace reply body before any DB write (review #7)', async () => {
      await expect(
        service.replyToGrievance(USER, 'g-1', '   '),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.grievanceMessage.create).not.toHaveBeenCalled();
    });

    it('clears resolvedAt/resolutionNote when a customer reply re-opens a RESOLVED ticket (review #2)', async () => {
      prisma.grievance.findUnique.mockResolvedValue({
        id: 'g-1',
        ticketNumber: 'GRV-1',
        raisedByUserId: USER,
        status: GrievanceStatus.RESOLVED,
        category: GrievanceCategory.OTHER,
        subject: 'x',
        createdAt: new Date(),
        assignedToUserId: null,
        messages: [],
      } as never);
      prisma.grievanceMessage.create.mockResolvedValue({ id: 'm-1' } as never);
      prisma.grievance.updateMany.mockResolvedValue({ count: 1 } as never);

      await service.replyToGrievance(USER, 'g-1', 'Still broken — please reopen.');

      // The re-open flip must null the stale resolution so the monthly report
      // stops counting a re-opened complaint as resolved.
      expect(prisma.grievance.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'g-1',
            status: GrievanceStatus.RESOLVED,
          }),
          data: expect.objectContaining({
            status: GrievanceStatus.IN_PROGRESS,
            resolvedAt: null,
            resolutionNote: null,
          }),
        }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // SLA escalation
  // ---------------------------------------------------------------------------

  describe('runSlaEscalation', () => {
    it('escalates an overdue open ticket once (guarded flip)', async () => {
      prisma.grievance.findMany.mockResolvedValue([{ id: 'g-1' }] as never);
      prisma.grievance.updateMany.mockResolvedValue({ count: 1 } as never);
      prisma.grievanceMessage.create.mockResolvedValue({ id: 'm-1' } as never);
      prisma.grievance.findUnique.mockResolvedValue({
        ticketNumber: 'GRV-1',
        assignedToUserId: null,
      } as never);

      const count = await service.runSlaEscalation(new Date());

      expect(count).toBe(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const flipArg = prisma.grievance.updateMany.mock.calls[0][0] as any;
      expect(flipArg.data.status).toBe(GrievanceStatus.ESCALATED);
      expect(outbox.enqueue).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({ type: 'email.grievance_status' }),
      );
    });

    it('does not count a ticket another actor already advanced (flip count 0)', async () => {
      prisma.grievance.findMany.mockResolvedValue([{ id: 'g-1' }] as never);
      prisma.grievance.updateMany.mockResolvedValue({ count: 0 } as never);

      const count = await service.runSlaEscalation(new Date());

      expect(count).toBe(0);
      expect(outbox.enqueue).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Monthly compliance report
  // ---------------------------------------------------------------------------

  describe('buildMonthlyComplianceReport', () => {
    it('rolls up counts, SLA compliance and average resolution time', async () => {
      const T0 = new Date('2026-07-05T00:00:00.000Z').getTime();
      const H = 60 * 60 * 1000;

      prisma.grievance.count
        .mockResolvedValueOnce(2 as never) // openingBacklog
        .mockResolvedValueOnce(5 as never) // received
        .mockResolvedValueOnce(1 as never) // closed
        .mockResolvedValueOnce(1 as never) // escalated
        .mockResolvedValueOnce(3 as never); // pending
      prisma.grievance.findMany.mockResolvedValueOnce([
        {
          createdAt: new Date(T0),
          resolvedAt: new Date(T0 + 10 * H),
          slaDueAt: new Date(T0 + 72 * H),
        },
        {
          createdAt: new Date(T0),
          resolvedAt: new Date(T0 + 100 * H),
          slaDueAt: new Date(T0 + 72 * H),
        },
      ] as never);
      prisma.grievance.groupBy
        .mockResolvedValueOnce([
          { category: 'DELIVERY', _count: { _all: 3 } },
        ] as never)
        .mockResolvedValueOnce([
          { status: 'RESOLVED', _count: { _all: 2 } },
        ] as never);

      const report = await service.buildMonthlyComplianceReport('2026-07');

      expect(report.received).toBe(5);
      expect(report.resolved).toBe(2);
      expect(report.slaBreached).toBe(1);
      expect(report.slaComplianceRate).toBe(50);
      expect(report.avgResolutionHours).toBe(55);
      expect(report.byCategory).toEqual([{ key: 'DELIVERY', count: 3 }]);
      expect(report.disclaimer).toMatch(/PROVISIONAL/);
    });
  });
});
