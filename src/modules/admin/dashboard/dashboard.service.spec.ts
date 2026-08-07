import { Test, TestingModule } from '@nestjs/testing';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { OrderStatus } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { DashboardService } from './dashboard.service';
import { AnalyticsBucket } from './dto/analytics-range.input';

/**
 * Sets happy-path resolved values for every Prisma call `getAnalytics` makes.
 * Money aggregates come back as strings (Prisma.Decimal serialization) so the
 * test also exercises the `Number(...)` coercion. `$queryRaw` is mocked flat —
 * the deep mock is a jest.fn regardless of the tagged-template call form.
 */
function setupHappyMocks(prisma: DeepMockProxy<PrismaService>) {
  prisma.order.aggregate.mockResolvedValue({
    _sum: { totalAmount: '1000' },
    _count: { _all: 10 },
  } as never);
  prisma.refund.aggregate.mockResolvedValue({
    _sum: { amount: '200' },
  } as never);
  prisma.$queryRaw.mockResolvedValue([
    { bucket: new Date('2026-07-01T00:00:00.000Z'), gmv: 1000, orders: 10 },
  ] as never);
  prisma.order.groupBy.mockResolvedValue([
    { status: OrderStatus.DELIVERED, _count: { _all: 7 } },
    { status: OrderStatus.PENDING, _count: { _all: 3 } },
  ] as never);
  prisma.user.count.mockResolvedValue(5 as never);
  prisma.seller.count.mockResolvedValue(2 as never);
  prisma.orderItem.groupBy.mockResolvedValue([
    { productId: 'p1', _sum: { quantity: 4, totalPrice: '800' } },
    { productId: 'p2', _sum: { quantity: 2, totalPrice: '200' } },
  ] as never);
  prisma.sellerOrder.groupBy.mockResolvedValue([
    {
      sellerId: 's1',
      _sum: { subtotal: '900', payoutAmount: '810' },
      _count: { _all: 6 },
    },
  ] as never);
  prisma.product.findMany.mockResolvedValue([
    { id: 'p1', name: 'Widget' },
    { id: 'p2', name: 'Gadget' },
  ] as never);
  prisma.seller.findMany.mockResolvedValue([
    { id: 's1', displayName: 'Acme' },
  ] as never);
}

describe('DashboardService — getAnalytics', () => {
  let service: DashboardService;
  let prisma: DeepMockProxy<PrismaService>;

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    const module: TestingModule = await Test.createTestingModule({
      providers: [DashboardService],
    })
      .useMocker((token) => (token === PrismaService ? prisma : mockDeep()))
      .compile();
    service = module.get<DashboardService>(DashboardService);
    setupHappyMocks(prisma);
  });

  it('nets PROCESSED refunds out of gross revenue and maps the leaderboards', async () => {
    const from = new Date('2026-07-01T00:00:00.000Z');
    const to = new Date('2026-07-31T00:00:00.000Z');

    const result = await service.getAnalytics({
      from,
      to,
      granularity: AnalyticsBucket.MONTH,
      topLimit: 5,
    });

    expect(result.revenue).toEqual({
      gross: 1000,
      refunds: 200,
      net: 800,
      orderCount: 10,
      avgOrderValue: 100,
    });
    expect(result.newSignups).toEqual({ users: 5, sellers: 2 });
    expect(result.range).toEqual({
      from,
      to,
      granularity: AnalyticsBucket.MONTH,
    });

    // Orders-by-status is zero-filled across all 7 statuses.
    expect(result.ordersByStatus).toHaveLength(7);
    const countFor = (s: OrderStatus) =>
      result.ordersByStatus.find((r) => r.status === s)?.count;
    expect(countFor(OrderStatus.DELIVERED)).toBe(7);
    expect(countFor(OrderStatus.PENDING)).toBe(3);
    expect(countFor(OrderStatus.SHIPPED)).toBe(0);

    expect(result.gmvSeries).toEqual([
      {
        bucket: '2026-07-01T00:00:00.000Z',
        label: 'Jul 2026',
        gmv: 1000,
        orderCount: 10,
      },
    ]);
    expect(result.topProducts).toEqual([
      { productId: 'p1', name: 'Widget', unitsSold: 4, grossRevenue: 800 },
      { productId: 'p2', name: 'Gadget', unitsSold: 2, grossRevenue: 200 },
    ]);
    expect(result.topSellers).toEqual([
      {
        sellerId: 's1',
        sellerName: 'Acme',
        orderCount: 6,
        gmv: 900,
        netPayable: 810,
      },
    ]);
  });

  it('defaults granularity to DAY and clamps topLimit into 1..20', async () => {
    const result = await service.getAnalytics({ topLimit: 100 });

    expect(result.range.granularity).toBe(AnalyticsBucket.DAY);
    expect(prisma.orderItem.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ take: 20 }),
    );
    expect(prisma.sellerOrder.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ take: 20 }),
    );
  });

  it('falls back to a ~30-day window when no range is supplied', async () => {
    const result = await service.getAnalytics();

    const span = result.range.to.getTime() - result.range.from.getTime();
    // 30 days, with a little slack for the Date.now() read.
    expect(span).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
    expect(span).toBeLessThanOrEqual(30 * 24 * 60 * 60 * 1000 + 1000);
  });

  it('resolves a placeholder name for a hard-deleted product', async () => {
    prisma.product.findMany.mockResolvedValue([
      { id: 'p1', name: 'Widget' },
    ] as never);

    const result = await service.getAnalytics({ topLimit: 5 });

    expect(result.topProducts[1]).toEqual({
      productId: 'p2',
      name: 'Unknown product',
      unitsSold: 2,
      grossRevenue: 200,
    });
  });
});
