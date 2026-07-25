import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { ConfigService } from '@nestjs/config';
import { Prisma, TcsLedgerKind } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { OutboxService } from '@/modules/outbox/outbox.service';
import { TcsService, toPeriod } from './tcs.service';

/**
 * TcsService unit tests (P3-03) — jest-mock-extended style, mirroring the
 * refund/payout money-path specs. Covers the intra-state 0.5%+0.5% split, the
 * inter-state 1% IGST split, the reversal sign + proportionality, and the
 * payout-netting (accruals − reversals, floored at 0).
 *
 * Per guard rule 7: assert the tx identity directly (the deep-mock proxy is
 * mis-read by expect.anything()), and read Decimal amounts via Number().
 */
describe('TcsService', () => {
  let service: TcsService;
  let prisma: DeepMockProxy<PrismaService>;
  let config: DeepMockProxy<ConfigService>;
  let outbox: DeepMockProxy<OutboxService>;

  const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    config = mockDeep<ConfigService>();
    outbox = mockDeep<OutboxService>();
    service = new TcsService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
      outbox as unknown as OutboxService,
    );
  });

  /** Grab the single row passed to the mocked tcsLedger.createMany. */
  function lastCreatedRows(): any[] {
    const call = (prisma.tcsLedger.createMany as jest.Mock).mock.calls.at(-1);
    return (call?.[0] as any).data as any[];
  }

  describe('accrue', () => {
    function stubSellerOrder(taxKind: string, shipTaxable = 0) {
      prisma.sellerOrder.findUnique.mockResolvedValue({
        id: 'so-1',
        storeId: 'store-1',
        sellerId: 'seller-1',
        taxKind,
        shippingTaxableValue: D(shipTaxable),
      } as never);
      prisma.orderItem.findMany.mockResolvedValue([
        { taxableValue: D(1000), hsnCode: '8518' },
      ] as never);
      prisma.tcsLedger.createMany.mockResolvedValue({ count: 1 } as never);
    }

    it('accrues a 0.5% + 0.5% CGST/SGST split for an intra-state supply', async () => {
      stubSellerOrder('INTRA_STATE');

      await service.accrue(prisma as never, 'so-1');

      const rows = lastCreatedRows();
      expect(rows).toHaveLength(1);
      const r = rows[0];
      expect(r.kind).toBe(TcsLedgerKind.ACCRUAL);
      expect(r.refundId).toBeNull();
      expect(Number(r.netTaxableValue)).toBe(1000);
      expect(Number(r.cgstTcs)).toBe(5); // 1000 * 0.5%
      expect(Number(r.sgstTcs)).toBe(5); // 1000 * 0.5%
      expect(Number(r.igstTcs)).toBe(0);
      expect(r.rateBps).toBe(100);
      // Idempotent write path (skipDuplicates → ON CONFLICT DO NOTHING).
      const arg = (prisma.tcsLedger.createMany as jest.Mock).mock.calls.at(-1)![0];
      expect(arg.skipDuplicates).toBe(true);
    });

    it('accrues a flat 1% IGST for an inter-state supply', async () => {
      stubSellerOrder('INTER_STATE');

      await service.accrue(prisma as never, 'so-1');

      const r = lastCreatedRows()[0];
      expect(Number(r.cgstTcs)).toBe(0);
      expect(Number(r.sgstTcs)).toBe(0);
      expect(Number(r.igstTcs)).toBe(10); // 1000 * 1%
    });

    it('includes shipping composite-supply taxable value in the base', async () => {
      stubSellerOrder('INTER_STATE', 200); // 1000 items + 200 shipping = 1200

      await service.accrue(prisma as never, 'so-1');

      const r = lastCreatedRows()[0];
      expect(Number(r.netTaxableValue)).toBe(1200);
      expect(Number(r.igstTcs)).toBe(12); // 1200 * 1%
    });

    it('skips accrual when the seller-order taxKind is unknown', async () => {
      prisma.sellerOrder.findUnique.mockResolvedValue({
        id: 'so-1',
        storeId: 'store-1',
        sellerId: 'seller-1',
        taxKind: null,
        shippingTaxableValue: D(0),
      } as never);

      await service.accrue(prisma as never, 'so-1');
      expect(prisma.tcsLedger.createMany).not.toHaveBeenCalled();
    });
  });

  describe('reverse', () => {
    const accrual = {
      id: 'led-1',
      kind: TcsLedgerKind.ACCRUAL,
      storeId: 'store-1',
      sellerId: 'seller-1',
      sellerOrderId: 'so-1',
      netTaxableValue: D(1000),
      cgstTcs: D(5),
      sgstTcs: D(5),
      igstTcs: D(0),
      rateBps: 100,
      taxKind: 'INTRA_STATE',
    };
    // gross = subtotal 1000 + tax 100 + shipping 0 − discount 0 = 1100
    const scoped = [
      {
        id: 'so-1',
        subtotal: D(1000),
        taxAmount: D(100),
        shippingAmount: D(0),
        discountAmount: D(0),
      },
    ];

    it('writes a fully-negative reversal for a full refund', async () => {
      prisma.tcsLedger.findMany.mockResolvedValue([accrual] as never);
      prisma.tcsLedger.groupBy.mockResolvedValue([] as never); // no prior reversals
      prisma.tcsLedger.createMany.mockResolvedValue({ count: 1 } as never);

      await service.reverse(
        prisma as never,
        { id: 'refund-1', amount: D(1100), sellerOrderId: 'so-1' },
        scoped as never,
      );

      const r = lastCreatedRows()[0];
      expect(r.kind).toBe(TcsLedgerKind.REVERSAL);
      expect(r.refundId).toBe('refund-1');
      expect(Number(r.cgstTcs)).toBe(-5);
      expect(Number(r.sgstTcs)).toBe(-5);
      expect(Number(r.netTaxableValue)).toBe(-1000);
    });

    it('reverses proportionally for a partial refund', async () => {
      prisma.tcsLedger.findMany.mockResolvedValue([accrual] as never);
      prisma.tcsLedger.groupBy.mockResolvedValue([] as never); // no prior reversals
      prisma.tcsLedger.createMany.mockResolvedValue({ count: 1 } as never);

      // Half the gross refunded → half the TCS reversed.
      await service.reverse(
        prisma as never,
        { id: 'refund-2', amount: D(550), sellerOrderId: 'so-1' },
        scoped as never,
      );

      const r = lastCreatedRows()[0];
      expect(Number(r.cgstTcs)).toBe(-2.5);
      expect(Number(r.sgstTcs)).toBe(-2.5);
      expect(Number(r.netTaxableValue)).toBe(-500);
    });

    it('clamps cumulative reversal — a 2nd refund on an already-fully-reversed seller order books nothing', async () => {
      // The accrual (10 total TCS) was already fully reversed by an earlier
      // refund. A second full refund on the same seller order must NOT reverse
      // again (would drive the ledger net negative and understate GSTR-8).
      prisma.tcsLedger.findMany.mockResolvedValue([accrual] as never);
      prisma.tcsLedger.groupBy.mockResolvedValue([
        {
          sellerOrderId: 'so-1',
          _sum: {
            cgstTcs: D(-5),
            sgstTcs: D(-5),
            igstTcs: D(0),
            netTaxableValue: D(-1000),
          },
        },
      ] as never);
      prisma.tcsLedger.createMany.mockResolvedValue({ count: 0 } as never);

      await service.reverse(
        prisma as never,
        { id: 'refund-dup', amount: D(1100), sellerOrderId: 'so-1' },
        scoped as never,
      );

      // Remaining reversible = accrued + prior = 0 → no row written.
      expect(prisma.tcsLedger.createMany).not.toHaveBeenCalled();
    });

    it('clamps a 2nd partial refund to the remaining balance (not a fresh full slice)', async () => {
      // Prior refund already reversed 7 of the 10 accrued (cgst 3.5 / sgst 3.5).
      // A second full-value refund would propose reversing the full 10 again;
      // it must be clamped to the remaining 3 (cgst 1.5 / sgst 1.5).
      prisma.tcsLedger.findMany.mockResolvedValue([accrual] as never);
      prisma.tcsLedger.groupBy.mockResolvedValue([
        {
          sellerOrderId: 'so-1',
          _sum: {
            cgstTcs: D(-3.5),
            sgstTcs: D(-3.5),
            igstTcs: D(0),
            netTaxableValue: D(-700),
          },
        },
      ] as never);
      prisma.tcsLedger.createMany.mockResolvedValue({ count: 1 } as never);

      await service.reverse(
        prisma as never,
        { id: 'refund-2b', amount: D(1100), sellerOrderId: 'so-1' },
        scoped as never,
      );

      const r = lastCreatedRows()[0];
      expect(Number(r.cgstTcs)).toBe(-1.5);
      expect(Number(r.sgstTcs)).toBe(-1.5);
      expect(Number(r.netTaxableValue)).toBe(-300);
    });

    it('writes nothing when there is no prior accrual', async () => {
      prisma.tcsLedger.findMany.mockResolvedValue([] as never);

      await service.reverse(
        prisma as never,
        { id: 'refund-3', amount: D(1100), sellerOrderId: 'so-1' },
        scoped as never,
      );
      expect(prisma.tcsLedger.createMany).not.toHaveBeenCalled();
    });
  });

  describe('netForSellerOrders', () => {
    it('nets accruals minus reversals and floors negatives at 0', async () => {
      prisma.tcsLedger.groupBy.mockResolvedValue([
        // so-1: accrued (5+5) then reversed (−2−2) → net 6
        { sellerOrderId: 'so-1', _sum: { cgstTcs: D(3), sgstTcs: D(3), igstTcs: D(0) } },
        // so-2: fully reversed → net −10 → floored to 0
        { sellerOrderId: 'so-2', _sum: { cgstTcs: D(-5), sgstTcs: D(-5), igstTcs: D(0) } },
        // so-3: inter-state 1% → 10
        { sellerOrderId: 'so-3', _sum: { cgstTcs: D(0), sgstTcs: D(0), igstTcs: D(10) } },
      ] as never);

      const net = await service.netForSellerOrders(['so-1', 'so-2', 'so-3']);
      expect(net.get('so-1')).toBe(6);
      expect(net.get('so-2')).toBe(0);
      expect(net.get('so-3')).toBe(10);
    });

    it('returns an empty map for no seller orders (no query)', async () => {
      const net = await service.netForSellerOrders([]);
      expect(net.size).toBe(0);
      expect(prisma.tcsLedger.groupBy).not.toHaveBeenCalled();
    });
  });

  describe('toPeriod', () => {
    it('formats a date as YYYY-MM', () => {
      expect(toPeriod(new Date(2026, 6, 18))).toBe('2026-07'); // month is 0-indexed
      expect(toPeriod(new Date(2026, 0, 1))).toBe('2026-01');
    });
  });
});
