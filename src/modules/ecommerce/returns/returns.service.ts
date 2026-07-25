/**
 * ReturnsService — Returns / RMA lifecycle (Phase 3, P3-02).
 *
 * A ReturnRequest walks a GUARDED state machine (see returns.constants.ts). Every
 * legal transition is applied with a CONDITIONAL updateMany (`where: { status:
 * <expected> }`) so a redelivered webhook / a racing caller / a retry can only
 * ever move the machine ONCE — the loser reads count===0 and no-ops. Each
 * transition writes an OrderStatusHistory-style ReturnEvent and (for the three
 * customer-facing milestones) enqueues a durable outbox email + in-app bell.
 *
 * The money-critical flow is QC_PASSED (see completeQcPassedRefund): it REUSES
 * the existing Phase-2 RefundService (guarded exactly-once refund + restock +
 * §52 TCS reversal — never re-implemented), writes a carry-forward
 * PayoutAdjustment commission clawback (payout.prisma), and books the §52 TCS
 * reversal for the returned slice. All external courier HTTP (reverse pickup)
 * happens OUTSIDE any DB transaction.
 */

import {
  BadRequestException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  OrderStatus,
  PaymentGateway,
  PayoutStatus,
  Prisma,
  ReturnResolutionType,
  ReturnStatus,
} from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { EmailService } from '@/modules/admin/email/email.service';
import { config } from '@/common/config/config';
import { OutboxService } from '@/modules/outbox/outbox.service';
import { OUTBOX_EVENT, OUTBOX_QUEUE } from '@/modules/outbox/outbox.constants';
import { RefundService } from '@/modules/ecommerce/payment/refund.service';
import { CourierService } from '@/modules/ecommerce/courier/courier.service';
import { TcsService } from '@/modules/compliance/tcs/tcs.service';
import { NotificationService } from '@/modules/notification/notification.service';
import { AuditService } from '@/modules/observability/audit/audit.service';
import { RequestReturnInput } from './dto/request-return.input';
import {
  isValidReturnTransition,
  replacementEnabled,
  RETURN_OUTBOX_EVENT,
  RETURN_REFUND_INCLUDE_SHIPPING,
  RETURN_WINDOW_DAYS,
} from './returns.constants';

const D = (v: Prisma.Decimal.Value): Prisma.Decimal => new Prisma.Decimal(v);
const ZERO = new Prisma.Decimal(0);
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const RMA_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function generateReturnNumber(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  let rnd = '';
  for (let i = 0; i < 7; i++)
    rnd += RMA_ALPHABET[Math.floor(Math.random() * RMA_ALPHABET.length)];
  return `RMA-${yyyy}-${mm}-${rnd}`;
}

@Injectable()
export class ReturnsService {
  private readonly logger = new Logger(ReturnsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly email: EmailService,
    // RefundService lives in PaymentModule (no cycle — Payment never imports
    // Returns). Optional trailing so the unit spec can construct positionally.
    private readonly refund?: RefundService,
    // CourierService via forwardRef (CourierModule imports ReturnsModule for the
    // reverse-webhook edge). Optional trailing for the spec + manual-pickup path.
    @Optional()
    @Inject(forwardRef(() => CourierService))
    private readonly courier?: CourierService,
    // @Global TcsService (P3-03) — reverse the §52 accrual for the returned slice.
    private readonly tcs?: TcsService,
    // @Global NotificationService (P3-08) — the bell entry alongside each email.
    private readonly notifications?: NotificationService,
    // @Global AuditService (P3-05) — best-effort trail of the money milestones.
    private readonly audit?: AuditService,
  ) {}

  // ===========================================================================
  // Customer
  // ===========================================================================

  /**
   * Open a return against ONE delivered seller-order. Policy gate: DELIVERED +
   * within RETURN_WINDOW_DAYS + items belong to the order + qty <= remaining
   * purchased (minus already-returned, non-rejected).
   */
  async requestReturn(userId: string, input: RequestReturnInput) {
    const customerId = await this.getCustomerId(userId);

    // Resolution gate: REPLACEMENT is only accepted while the (runtime-settable)
    // flag is on. A REPLACEMENT return NEVER touches the refund/clawback/TCS
    // path — it forks the state machine at QC_PASSED.
    const resolutionType =
      input.resolutionType ?? ReturnResolutionType.REFUND;
    if (
      resolutionType === ReturnResolutionType.REPLACEMENT &&
      !replacementEnabled()
    ) {
      throw new BadRequestException(
        'Replacement returns are not available yet — please choose a refund.',
      );
    }

    const so = await this.prisma.sellerOrder.findUnique({
      where: { id: input.sellerOrderId },
      include: { order: true, items: true },
    });
    if (!so || so.deletedAt) throw new NotFoundException('Order not found.');
    if (so.order.customerId !== customerId) {
      throw new ForbiddenException('You do not own this order.');
    }
    if (so.status !== OrderStatus.DELIVERED) {
      throw new BadRequestException(
        'Only delivered orders can be returned.',
      );
    }

    // Window gate. // NEEDS FINANCE/LEGAL SIGN-OFF — RETURN_WINDOW_DAYS.
    const deliveredAt = so.deliveredAt ?? so.order.deliveredAt;
    if (!deliveredAt) {
      throw new BadRequestException(
        'This order has no delivery date on record; contact support.',
      );
    }
    const windowMs = RETURN_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    if (Date.now() - deliveredAt.getTime() > windowMs) {
      throw new BadRequestException(
        `The ${RETURN_WINDOW_DAYS}-day return window for this order has closed.`,
      );
    }

    // AGGREGATE incoming lines per orderItemId first — a client sending the same
    // orderItemId across multiple lines must NOT have each line separately pass
    // the per-item cap (that would multiply the refund). Sum + collapse to one
    // ReturnItem per order-item, and reject items not on this seller order.
    const itemsById = new Map(so.items.map((it) => [it.id, it]));
    const requestedByItem = new Map<
      string,
      { quantity: number; condition: string | null }
    >();
    for (const line of input.items) {
      if (!itemsById.has(line.orderItemId)) {
        throw new BadRequestException(
          'A returned item does not belong to this order.',
        );
      }
      const prev = requestedByItem.get(line.orderItemId);
      requestedByItem.set(line.orderItemId, {
        quantity: (prev?.quantity ?? 0) + line.quantity,
        condition: line.condition ?? prev?.condition ?? null,
      });
    }

    const returnNumber = generateReturnNumber();
    const created = await this.prisma.$transaction(async (tx) => {
      // Serialize concurrent return requests for this seller order: the lock
      // makes the returned-quantity check-then-create atomic, so two racing
      // requests can't each pass with a stale alreadyReturned=0 snapshot.
      await tx.$queryRaw`SELECT id FROM "SellerOrder" WHERE id = ${so.id} FOR UPDATE`;

      // Re-read already-returned INSIDE the lock and validate the SUMMED
      // requested quantity per order-item against the remaining allowance.
      const alreadyReturned = await this.returnedQtyByOrderItem(so.id, tx);
      for (const [orderItemId, req] of requestedByItem) {
        const oi = itemsById.get(orderItemId)!;
        const remaining = oi.quantity - (alreadyReturned.get(orderItemId) ?? 0);
        if (req.quantity > remaining) {
          throw new BadRequestException(
            `You can return at most ${remaining} of "${oi.name}".`,
          );
        }
      }

      const rr = await tx.returnRequest.create({
        data: {
          returnNumber,
          orderId: so.orderId,
          sellerOrderId: so.id,
          sellerId: so.sellerId,
          storeId: so.storeId,
          customerId,
          status: ReturnStatus.REQUESTED,
          resolutionType,
          reason: input.reason,
          customerNote: input.customerNote ?? null,
          items: {
            create: Array.from(requestedByItem, ([orderItemId, req]) => ({
              orderItemId,
              quantity: req.quantity,
              condition: req.condition,
            })),
          },
          events: {
            create: {
              fromStatus: null,
              toStatus: ReturnStatus.REQUESTED,
              note: 'Return requested by customer',
              actorUserId: userId,
            },
          },
        },
        include: { items: true, events: true },
      });
      return rr;
    });

    // Notify the seller a return is awaiting review (best-effort in-app bell).
    const sellerUserId = await this.sellerUserId(so.sellerId);
    if (sellerUserId) {
      await this.notifications?.create({
        userId: sellerUserId,
        type: 'return_requested',
        title: 'New return request',
        body: `Return ${returnNumber} was requested for order ${so.orderNumber}.`,
        data: { returnId: created.id, returnNumber, link: `/seller/returns/${created.id}` },
        dedupeKey: `notif:return_requested:${created.id}`,
      });
    }

    return created;
  }

  async myReturns(userId: string) {
    const customerId = await this.getCustomerId(userId);
    return this.prisma.returnRequest.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      include: { items: true },
    });
  }

  async myReturnDetail(userId: string, id: string) {
    const customerId = await this.getCustomerId(userId);
    const rr = await this.prisma.returnRequest.findUnique({
      where: { id },
      include: { items: true, events: { orderBy: { createdAt: 'asc' } } },
    });
    if (!rr || rr.customerId !== customerId) {
      throw new NotFoundException('Return not found.');
    }
    return rr;
  }

  // ===========================================================================
  // Seller
  // ===========================================================================

  async sellerReturns(
    userId: string,
    filter: { status?: ReturnStatus; page?: number; pageSize?: number } = {},
  ) {
    const sellerId = await this.getSellerId(userId);
    return this.listReturns({ ...filter, sellerId });
  }

  async sellerReturnDetail(userId: string, id: string) {
    const sellerId = await this.getSellerId(userId);
    const rr = await this.loadDetail(id);
    if (rr.sellerId !== sellerId) throw new NotFoundException('Return not found.');
    return rr;
  }

  /** REQUESTED → APPROVED. Emits the customer `return_approved` email + bell. */
  async approveReturn(userId: string, id: string) {
    const sellerId = await this.getSellerId(userId);
    const rr = await this.requireReturn(id);
    if (rr.sellerId !== sellerId) throw new ForbiddenException('Not your return.');
    this.assertTransition(rr.status, ReturnStatus.APPROVED);

    await this.prisma.$transaction(async (tx) => {
      const flip = await tx.returnRequest.updateMany({
        where: { id, status: ReturnStatus.REQUESTED },
        data: { status: ReturnStatus.APPROVED, approvedAt: new Date(), approvedById: userId },
      });
      if (flip.count === 0) return; // already advanced
      await this.writeEvent(tx, id, ReturnStatus.REQUESTED, ReturnStatus.APPROVED, 'Approved by seller', userId);
      await this.outbox.enqueue(tx, {
        type: OUTBOX_EVENT.EMAIL_RETURN_APPROVED,
        queue: OUTBOX_QUEUE.EMAILS,
        payload: { returnId: id },
        dedupeKey: `email:return_approved:${id}`,
      });
    });
    return this.loadDetail(id);
  }

  /** REQUESTED (or QC_FAILED) → REJECTED. No refund. */
  async rejectReturn(userId: string, id: string, reason?: string) {
    const sellerId = await this.getSellerId(userId);
    const rr = await this.requireReturn(id);
    if (rr.sellerId !== sellerId) throw new ForbiddenException('Not your return.');
    this.assertTransition(rr.status, ReturnStatus.REJECTED);

    const from = rr.status;
    await this.prisma.$transaction(async (tx) => {
      const flip = await tx.returnRequest.updateMany({
        where: { id, status: from },
        data: {
          status: ReturnStatus.REJECTED,
          rejectedAt: new Date(),
          rejectionReason: reason ?? null,
        },
      });
      if (flip.count === 0) return;
      await this.writeEvent(tx, id, from, ReturnStatus.REJECTED, reason ?? 'Rejected', userId);
    });
    await this.notifyCustomer(id, 'return_rejected', 'Return declined', reason);
    return this.loadDetail(id);
  }

  /**
   * APPROVED → PICKUP_SCHEDULED. Generates a Shiprocket REVERSE AWB (external
   * HTTP OUTSIDE any transaction). Falls back to a manual pickup when the seller
   * has no connected courier.
   */
  async scheduleReturnPickup(userId: string, id: string) {
    const sellerId = await this.getSellerId(userId);
    const rr = await this.requireReturn(id);
    if (rr.sellerId !== sellerId) throw new ForbiddenException('Not your return.');
    this.assertTransition(rr.status, ReturnStatus.PICKUP_SCHEDULED);

    // External courier call OUTSIDE the DB transaction.
    const reverse = await this.courier?.createReturnShipment({
      sellerOrderId: rr.sellerOrderId,
      returnNumber: rr.returnNumber,
    });

    await this.prisma.$transaction(async (tx) => {
      const flip = await tx.returnRequest.updateMany({
        where: { id, status: ReturnStatus.APPROVED },
        data: {
          status: ReturnStatus.PICKUP_SCHEDULED,
          pickupScheduledAt: new Date(),
          reverseAwb: reverse?.reverseAwb ?? null,
          reverseShipmentId: reverse?.reverseShipmentId ?? null,
          reverseProviderOrderId: reverse?.reverseProviderOrderId ?? null,
          reverseLabelUrl: reverse?.reverseLabelUrl ?? null,
          reverseProvider: reverse?.provider ?? null,
        },
      });
      if (flip.count === 0) return;
      await this.writeEvent(
        tx,
        id,
        ReturnStatus.APPROVED,
        ReturnStatus.PICKUP_SCHEDULED,
        reverse?.reverseAwb
          ? `Reverse pickup scheduled (AWB ${reverse.reverseAwb})`
          : 'Manual pickup scheduled',
        userId,
      );
    });
    return this.loadDetail(id);
  }

  /**
   * Seller confirms the parcel is physically back (manual RECEIVED, when no
   * reverse webhook fires). PICKUP_SCHEDULED/IN_TRANSIT → RECEIVED.
   */
  async markReturnReceived(userId: string, id: string) {
    const sellerId = await this.getSellerId(userId);
    const rr = await this.requireReturn(id);
    if (rr.sellerId !== sellerId) throw new ForbiddenException('Not your return.');
    await this.transitionToReceived(id, userId, 'Marked received by seller');
    return this.loadDetail(id);
  }

  /**
   * REPLACEMENT arm: REPLACEMENT_APPROVED → REPLACEMENT_SHIPPED. The seller
   * records the outbound reference (their own tracking/AWB for the swap unit)
   * and the customer is emailed. Ownership-checked; conditional flip is the
   * winner-elect so a double-submit writes nothing new.
   */
  async markReplacementShipped(
    userId: string,
    id: string,
    reference?: string,
    note?: string,
  ) {
    const sellerId = await this.getSellerId(userId);
    const rr = await this.requireReturn(id);
    if (rr.sellerId !== sellerId) throw new ForbiddenException('Not your return.');
    this.assertTransition(rr.status, ReturnStatus.REPLACEMENT_SHIPPED);

    await this.prisma.$transaction(async (tx) => {
      const flip = await tx.returnRequest.updateMany({
        where: { id, status: ReturnStatus.REPLACEMENT_APPROVED },
        data: {
          status: ReturnStatus.REPLACEMENT_SHIPPED,
          replacementShippedAt: new Date(),
          replacementReference: reference ?? null,
        },
      });
      if (flip.count === 0) return;
      await this.writeEvent(
        tx,
        id,
        ReturnStatus.REPLACEMENT_APPROVED,
        ReturnStatus.REPLACEMENT_SHIPPED,
        reference
          ? `Replacement shipped (ref ${reference})${note ? ` — ${note}` : ''}`
          : `Replacement shipped${note ? ` — ${note}` : ''}`,
        userId,
      );
      await this.outbox.enqueue(tx, {
        type: RETURN_OUTBOX_EVENT.REPLACEMENT_SHIPPED,
        queue: OUTBOX_QUEUE.EMAILS,
        payload: { returnId: id },
        dedupeKey: `email:return_replacement_shipped:${id}`,
      });
    });
    return this.loadDetail(id);
  }

  /**
   * QC decision. pass=true → RECEIVED → QC_PASSED and the resolution fan-out
   * (refund OR replacement); pass=false → RECEIVED → QC_FAILED (no refund).
   */
  async qcReturn(userId: string, id: string, pass: boolean, note?: string) {
    const sellerId = await this.getSellerId(userId);
    const rr = await this.requireReturn(id);
    if (rr.sellerId !== sellerId) throw new ForbiddenException('Not your return.');

    if (!pass) {
      this.assertTransition(rr.status, ReturnStatus.QC_FAILED);
      await this.prisma.$transaction(async (tx) => {
        const flip = await tx.returnRequest.updateMany({
          where: { id, status: ReturnStatus.RECEIVED },
          data: { status: ReturnStatus.QC_FAILED, qcFailedAt: new Date(), qcNote: note ?? null },
        });
        if (flip.count === 0) return;
        await this.writeEvent(tx, id, ReturnStatus.RECEIVED, ReturnStatus.QC_FAILED, note ?? 'Failed inspection', userId);
      });
      await this.notifyCustomer(id, 'return_qc_failed', 'Return inspection failed', note);
      return this.loadDetail(id);
    }

    this.assertTransition(rr.status, ReturnStatus.QC_PASSED);
    await this.prisma.$transaction(async (tx) => {
      const flip = await tx.returnRequest.updateMany({
        where: { id, status: ReturnStatus.RECEIVED },
        data: { status: ReturnStatus.QC_PASSED, qcPassedAt: new Date(), qcNote: note ?? null },
      });
      if (flip.count === 0) return;
      await this.writeEvent(tx, id, ReturnStatus.RECEIVED, ReturnStatus.QC_PASSED, note ?? 'Passed inspection', userId);
    });

    // Post-QC fan-out (own guarded flow; idempotent). Runs after the QC_PASSED
    // commit so the completion is never lost to a QC rollback. Forks on
    // resolutionType: REFUND → money fan-out; REPLACEMENT → ship-a-swap intent.
    await this.completeQcPassed(id, userId);
    return this.loadDetail(id);
  }

  /**
   * Dispatch a QC_PASSED return to its resolution arm. REFUND fans out to the
   * guarded money path; REPLACEMENT records the reship intent (NO refund). Used
   * by qcReturn + the reconciliation cron so both arms are crash-recoverable.
   */
  async completeQcPassed(id: string, actorUserId?: string): Promise<void> {
    const rr = await this.prisma.returnRequest.findUnique({
      where: { id },
      select: { resolutionType: true },
    });
    if (!rr) return;
    if (rr.resolutionType === ReturnResolutionType.REPLACEMENT) {
      await this.completeQcPassedReplacement(id, actorUserId);
    } else {
      await this.completeQcPassedRefund(id, actorUserId);
    }
  }

  /**
   * REPLACEMENT arm: QC_PASSED → REPLACEMENT_APPROVED. Records the reship intent,
   * enqueues the customer "replacement approved" email, and notifies the seller
   * to ship the swap unit. This path NEVER refunds, claws back, reverses TCS, or
   * restocks — the returned (usually defective) unit stays with the seller and a
   * fresh unit ships. Idempotent: the conditional QC_PASSED → REPLACEMENT_APPROVED
   * flip elects a single winner; a retry / redelivery writes nothing new.
   */
  async completeQcPassedReplacement(
    id: string,
    actorUserId?: string,
  ): Promise<void> {
    const rr = await this.prisma.returnRequest.findUnique({ where: { id } });
    if (!rr) return;
    if (rr.status !== ReturnStatus.QC_PASSED) return; // only from QC_PASSED
    if (rr.resolutionType !== ReturnResolutionType.REPLACEMENT) {
      // Defence in depth: a REFUND return must never reach the replacement path.
      throw new BadRequestException(
        'completeQcPassedReplacement called for a non-REPLACEMENT return.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const flip = await tx.returnRequest.updateMany({
        where: { id, status: ReturnStatus.QC_PASSED },
        data: {
          status: ReturnStatus.REPLACEMENT_APPROVED,
          replacementApprovedAt: new Date(),
        },
      });
      if (flip.count === 0) return; // another caller already advanced → no-op
      await this.writeEvent(
        tx,
        id,
        ReturnStatus.QC_PASSED,
        ReturnStatus.REPLACEMENT_APPROVED,
        'Replacement approved — awaiting reshipment (no refund)',
        actorUserId ?? null,
      );
      await this.outbox.enqueue(tx, {
        type: RETURN_OUTBOX_EVENT.REPLACEMENT_APPROVED,
        queue: OUTBOX_QUEUE.EMAILS,
        payload: { returnId: id },
        dedupeKey: `email:return_replacement_approved:${id}`,
      });
    });

    // Best-effort seller nudge to ship the swap unit (in-app bell).
    const sellerUserId = await this.sellerUserId(rr.sellerId);
    if (sellerUserId) {
      await this.notifications?.create({
        userId: sellerUserId,
        type: 'return_replacement_ship',
        title: 'Ship a replacement',
        body: `Return ${rr.returnNumber} passed QC — ship the replacement unit and mark it shipped.`,
        data: {
          returnId: id,
          returnNumber: rr.returnNumber,
          link: `/seller/returns/${id}`,
        },
        dedupeKey: `notif:return_replacement_ship:${id}`,
      });
    }

    await this.audit?.record({
      action: 'return.replacement_approved',
      entityType: 'ReturnRequest',
      entityId: id,
      actorUserId: actorUserId ?? null,
      before: { status: ReturnStatus.QC_PASSED },
      after: { status: ReturnStatus.REPLACEMENT_APPROVED },
    });
  }

  // ===========================================================================
  // Money fan-out — QC_PASSED → REFUNDED (idempotent).
  // ===========================================================================

  /**
   * Complete a QC_PASSED return: (a) reuse RefundService for the buyer refund +
   * restock (+ its own §52 reversal), (b) write the carry-forward commission
   * clawback, (c) book the §52 TCS reversal for the returned slice, then flip to
   * REFUNDED. Idempotent: only runs from QC_PASSED, and the QC_PASSED → REFUNDED
   * conditional flip lets exactly one caller apply the clawback/TCS/email — a
   * retried or redelivered call writes NOTHING new.
   */
  async completeQcPassedRefund(id: string, actorUserId?: string): Promise<void> {
    const rr = await this.prisma.returnRequest.findUnique({ where: { id } });
    if (!rr) return;
    if (rr.status !== ReturnStatus.QC_PASSED) return; // only completes from QC_PASSED
    if (rr.resolutionType !== ReturnResolutionType.REFUND) {
      // Hard guard: a REPLACEMENT return must NEVER reach the refund / clawback /
      // TCS-reversal path. It is routed to completeQcPassedReplacement instead.
      throw new BadRequestException(
        'A REPLACEMENT return must not be refunded — it is resolved via the replacement path.',
      );
    }
    if (!this.refund) {
      throw new BadRequestException('Refund engine is unavailable.');
    }
    const refundService = this.refund;

    const so = await this.prisma.sellerOrder.findUnique({
      where: { id: rr.sellerOrderId },
      include: { items: true },
    });
    if (!so) throw new NotFoundException('Seller order not found.');

    const returnItems = await this.prisma.returnItem.findMany({
      where: { returnRequestId: id },
    });
    const refundAmount = this.computeReturnRefundAmount(so, returnItems);

    // (a) Reuse the existing guarded refund (restock + its own TCS reversal).
    // refundForReturn is idempotent PER RETURN: it creates + links the refund to
    // this ReturnRequest in one transaction and only then moves money, so a
    // crash-and-resume (reconciliation cron) reuses the same refund and re-drives
    // the idempotent execution rather than creating a second one — no double
    // refund even when the payment still has refundable headroom.
    const refund = (await refundService.refundForReturn({
      orderId: rr.orderId,
      sellerOrderId: rr.sellerOrderId,
      amount: refundAmount,
      reason: `Return ${rr.returnNumber}`,
      approvedById: actorUserId ?? null,
      returnRequestId: id,
    })) as { id: string; amount: Prisma.Decimal; status: string };

    // Commission clawback basis: recover the seller's settled share ONLY when the
    // seller order was already paid out / in a run (else exclusion from the payout
    // preview already prevents paying for a refunded order — a clawback there
    // would double-penalise). // NEEDS FINANCE SIGN-OFF — basis + carry-forward.
    // Use the amount ACTUALLY refunded (refundForReturn clamps to the payment's
    // remaining refundable headroom) — not the pre-clamp computed amount — so the
    // clawback fraction, the stored record, and the customer email all agree with
    // what the buyer really received. (review #5)
    const actualRefund = D(refund.amount);
    const gross = this.sellerOrderGross(so);
    const ratio = gross.gt(0) ? actualRefund.div(gross) : ZERO;
    const returnedFraction = ratio.gt(1) ? D(1) : ratio;
    const clawbackAmount =
      so.payoutStatus === PayoutStatus.PAID ||
      so.payoutStatus === PayoutStatus.PROCESSING
        ? round2(Number(D(so.payoutAmount).mul(returnedFraction).toFixed(2)))
        : 0;

    // (b) + (c) + flip → REFUNDED, all in one guarded transaction. The
    // QC_PASSED → REFUNDED conditional flip elects the single winner.
    await this.prisma.$transaction(async (tx) => {
      const flip = await tx.returnRequest.updateMany({
        where: { id, status: ReturnStatus.QC_PASSED },
        data: {
          status: ReturnStatus.REFUNDED,
          refundedAt: new Date(),
          refundId: refund.id,
          refundAmount: actualRefund,
        },
      });
      if (flip.count === 0) return; // another caller already finalized → no-op

      await this.writeEvent(
        tx,
        id,
        ReturnStatus.QC_PASSED,
        ReturnStatus.REFUNDED,
        `Refund of ₹${actualRefund.toFixed(2)} processed`,
        actorUserId ?? null,
      );

      // (b) Carry-forward commission clawback (idempotent via partial unique on
      // returnId → createMany skipDuplicates never aborts this transaction).
      if (clawbackAmount > 0) {
        await tx.payoutAdjustment.createMany({
          data: [
            {
              sellerId: rr.sellerId,
              sellerOrderId: rr.sellerOrderId,
              returnId: id,
              refundId: refund.id,
              kind: 'RETURN_CLAWBACK',
              status: 'PENDING',
              amount: new Prisma.Decimal(clawbackAmount),
              description: `Return ${rr.returnNumber} clawback`,
              createdById: actorUserId ?? null,
            },
          ],
          skipDuplicates: true,
        });
      }

      // (c) §52 TCS reversal for the returned slice. Booked only when the refund
      // actually PROCESSED (a COD manual refund reverses at finance approval).
      // Idempotent + cumulative-clamped (partial unique on sellerOrderId+refundId)
      // so this is a safety net even though RefundService.finalizeRefund already
      // reversed for a prepaid refund. // NEEDS CA SIGN-OFF — reversal timing.
      if (refund.status === 'PROCESSED') {
        await this.tcs?.reverse(
          tx,
          { id: refund.id, amount: refund.amount, sellerOrderId: rr.sellerOrderId },
          [
            {
              id: so.id,
              subtotal: so.subtotal,
              taxAmount: so.taxAmount,
              shippingAmount: so.shippingAmount,
              discountAmount: so.discountAmount,
            },
          ],
        );
      }

      // "Return refunded" buyer email — enqueue ONLY when the money actually
      // moved (prepaid → PROCESSED). A COD return refund is still REQUESTED here;
      // the buyer is emailed at manual disbursement (order_refunded) instead, so
      // we never tell the customer they've been refunded before the UTR is paid.
      if (refund.status === 'PROCESSED') {
        await this.outbox.enqueue(tx, {
          type: OUTBOX_EVENT.EMAIL_RETURN_REFUNDED,
          queue: OUTBOX_QUEUE.EMAILS,
          payload: { returnId: id },
          dedupeKey: `email:return_refunded:${id}`,
        });
      }
    });

    await this.audit?.record({
      action: 'return.refunded',
      entityType: 'ReturnRequest',
      entityId: id,
      actorUserId: actorUserId ?? null,
      before: { status: ReturnStatus.QC_PASSED },
      after: { status: ReturnStatus.REFUNDED, refundId: refund.id, clawbackAmount },
    });
  }

  // ===========================================================================
  // Reverse courier webhook (called by CourierService)
  // ===========================================================================

  /** Advance from a reverse-pickup scan. system-driven (no actor). Idempotent. */
  async advanceFromReverseScan(
    id: string,
    target: 'IN_TRANSIT' | 'RECEIVED',
    note: string,
  ): Promise<void> {
    if (target === 'IN_TRANSIT') {
      await this.prisma.$transaction(async (tx) => {
        const flip = await tx.returnRequest.updateMany({
          where: { id, status: ReturnStatus.PICKUP_SCHEDULED },
          data: { status: ReturnStatus.IN_TRANSIT, inTransitAt: new Date() },
        });
        if (flip.count === 0) return;
        await this.writeEvent(tx, id, ReturnStatus.PICKUP_SCHEDULED, ReturnStatus.IN_TRANSIT, note, null);
      });
      return;
    }
    await this.transitionToReceived(id, null, note);
  }

  // ===========================================================================
  // Admin
  // ===========================================================================

  async listReturns(filter: {
    status?: ReturnStatus;
    sellerId?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, filter.pageSize ?? 10));
    const where: Prisma.ReturnRequestWhereInput = {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.sellerId ? { sellerId: filter.sellerId } : {}),
    };
    const [rows, totalCount] = await this.prisma.$transaction([
      this.prisma.returnRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { items: true },
      }),
      this.prisma.returnRequest.count({ where }),
    ]);
    return {
      items: rows,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
      currentPage: page,
      pageSize,
    };
  }

  async adminReturnDetail(id: string) {
    const rr = await this.loadDetail(id);
    // Attach the linked-refund summary so finance can disburse a manual (COD)
    // return refund from the admin returns detail. Best-effort read; null when
    // there's no linked refund yet (e.g. a replacement or a pre-QC return).
    const manualRefund = await this.loadManualRefundInfo(rr.refundId);
    return Object.assign(rr, { manualRefund });
  }

  /**
   * Summarise a return's linked Refund for the admin detail. Flags a COD /
   * no-gateway refund still in REQUESTED as `disbursable` (finance must pay it
   * by hand + record the UTR), and surfaces the recorded reference once paid.
   */
  private async loadManualRefundInfo(refundId: string | null | undefined) {
    if (!refundId) return null;
    const refund = await this.prisma.refund.findUnique({
      where: { id: refundId },
      include: { payment: { select: { gateway: true, gatewayPaymentId: true } } },
    });
    if (!refund) return null;
    const isManual =
      refund.payment.gateway === PaymentGateway.COD ||
      !refund.payment.gatewayPaymentId;
    const gw = (refund.gatewayResponse ?? {}) as Record<string, unknown>;
    const reference =
      gw && typeof gw === 'object' && gw.manual
        ? ((gw.reference as string | undefined) ?? null)
        : null;
    return {
      id: refund.id,
      status: refund.status as string,
      amount: Number(refund.amount),
      isManual,
      disbursable: isManual && refund.status === 'REQUESTED',
      reference,
    };
  }

  // ===========================================================================
  // Reconciliation (invoked by ReturnsReconciliationCron)
  // ===========================================================================

  /**
   * Backstop for returns stuck in QC_PASSED (a crash after the QC flip but before
   * the refund fan-out committed). Re-runs the idempotent completion. Returns the
   * number resumed.
   */
  async reconcileStuckReturns(): Promise<number> {
    const stuck = await this.prisma.returnRequest.findMany({
      where: { status: ReturnStatus.QC_PASSED },
      select: { id: true, approvedById: true },
      take: 50,
    });
    let resumed = 0;
    for (const r of stuck) {
      try {
        await this.completeQcPassed(r.id, r.approvedById ?? undefined);
        resumed++;
      } catch (e) {
        this.logger.warn(
          `Return ${r.id} QC_PASSED resume failed: ${(e as Error).message}`,
        );
      }
    }
    return resumed;
  }

  // ===========================================================================
  // Outbox handlers (email + in-app bell) — idempotent, best-effort bell.
  // ===========================================================================

  async sendReturnApprovedEmail(id: string): Promise<void> {
    await this.sendReturnEmail(id, {
      type: 'return_approved',
      notifType: 'return_approved',
      title: 'Return approved',
      subjectBody: (rr) =>
        `Your return ${rr.returnNumber} has been approved. A pickup will be arranged.`,
    });
  }

  async sendReturnReceivedEmail(id: string): Promise<void> {
    await this.sendReturnEmail(id, {
      type: 'return_received',
      notifType: 'return_received',
      title: 'Return received',
      subjectBody: (rr) =>
        `We've received your returned items for ${rr.returnNumber} and started inspection.`,
    });
  }

  async sendReturnRefundedEmail(id: string): Promise<void> {
    await this.sendReturnEmail(id, {
      type: 'return_refunded',
      notifType: 'return_refunded',
      title: 'Return refunded',
      subjectBody: (rr) =>
        `Your return ${rr.returnNumber} is complete and your refund of ₹${Number(
          rr.refundAmount ?? 0,
        ).toFixed(2)} has been processed.`,
    });
  }

  async sendReturnReplacementApprovedEmail(id: string): Promise<void> {
    await this.sendReturnEmail(id, {
      type: 'return_replacement_approved',
      notifType: 'return_replacement_approved',
      title: 'Replacement approved',
      subjectBody: (rr) =>
        `Good news — your return ${rr.returnNumber} passed inspection and a replacement is being prepared for shipment.`,
    });
  }

  async sendReturnReplacementShippedEmail(id: string): Promise<void> {
    await this.sendReturnEmail(id, {
      type: 'return_replacement_shipped',
      notifType: 'return_replacement_shipped',
      title: 'Replacement shipped',
      subjectBody: (rr) =>
        `Your replacement for return ${rr.returnNumber} has been shipped.`,
    });
  }

  // ===========================================================================
  // Internals
  // ===========================================================================

  private async sendReturnEmail(
    id: string,
    opts: {
      type: string;
      notifType: string;
      title: string;
      subjectBody: (rr: {
        returnNumber: string;
        refundAmount: Prisma.Decimal | null;
      }) => string;
    },
  ): Promise<void> {
    const rr = await this.prisma.returnRequest.findUnique({ where: { id } });
    if (!rr) return;
    const customer = await this.prisma.customer.findUnique({
      where: { id: rr.customerId },
      include: { user: true },
    });

    const body = opts.subjectBody(rr);
    const link = `/account/returns/${rr.id}`;

    // In-app bell first (idempotent), then email.
    if (customer?.userId) {
      await this.notifications?.create({
        userId: customer.userId,
        type: opts.notifType,
        title: opts.title,
        body,
        data: { returnId: rr.id, returnNumber: rr.returnNumber, link },
        dedupeKey: `notif:${opts.notifType}:${rr.id}`,
      });
    }

    const to = customer?.user?.email;
    if (!to) return;
    const result = await this.email.send(opts.type, to, {
      customerName: customer?.user?.name ?? 'there',
      returnNumber: rr.returnNumber,
      message: body,
      returnLink: `${config.FRONTEND_URL ?? ''}${link}`,
    });
    if (!result.sent && !result.skipped) {
      throw new Error(`${opts.type} email failed: ${result.message}`);
    }
  }

  /** PICKUP_SCHEDULED/IN_TRANSIT → RECEIVED. Emits `return_received`. */
  private async transitionToReceived(
    id: string,
    actorUserId: string | null,
    note: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.returnRequest.findUnique({
        where: { id },
        select: { status: true },
      });
      if (!current) return;
      if (
        current.status !== ReturnStatus.PICKUP_SCHEDULED &&
        current.status !== ReturnStatus.IN_TRANSIT
      ) {
        return; // idempotent — already received / past it
      }
      const flip = await tx.returnRequest.updateMany({
        where: {
          id,
          status: { in: [ReturnStatus.PICKUP_SCHEDULED, ReturnStatus.IN_TRANSIT] },
        },
        data: { status: ReturnStatus.RECEIVED, receivedAt: new Date() },
      });
      if (flip.count === 0) return;
      await this.writeEvent(tx, id, current.status, ReturnStatus.RECEIVED, note, actorUserId);
      await this.outbox.enqueue(tx, {
        type: OUTBOX_EVENT.EMAIL_RETURN_RECEIVED,
        queue: OUTBOX_QUEUE.EMAILS,
        payload: { returnId: id },
        dedupeKey: `email:return_received:${id}`,
      });
    });
  }

  private async writeEvent(
    tx: Prisma.TransactionClient,
    returnRequestId: string,
    from: ReturnStatus | null,
    to: ReturnStatus,
    note: string,
    actorUserId: string | null,
  ): Promise<void> {
    await tx.returnEvent.create({
      data: { returnRequestId, fromStatus: from, toStatus: to, note, actorUserId },
    });
  }

  private assertTransition(from: ReturnStatus, to: ReturnStatus): void {
    if (!isValidReturnTransition(from, to)) {
      throw new BadRequestException(
        `A return cannot move from ${from} to ${to}.`,
      );
    }
  }

  /** Σ per-returned-line gross (price − discount + tax), proportional to qty. */
  private computeReturnRefundAmount(
    so: {
      subtotal: Prisma.Decimal;
      taxAmount: Prisma.Decimal;
      shippingAmount: Prisma.Decimal;
      discountAmount: Prisma.Decimal;
      items: {
        id: string;
        quantity: number;
        totalPrice: Prisma.Decimal;
        taxAmount: Prisma.Decimal;
        discountAmount: Prisma.Decimal;
      }[];
    },
    returnItems: { orderItemId: string; quantity: number }[],
  ): number {
    const byId = new Map(so.items.map((it) => [it.id, it]));
    let total = ZERO;
    let allReturned = true;
    for (const oi of so.items) {
      const ret = returnItems.find((r) => r.orderItemId === oi.id);
      if (!ret || ret.quantity < oi.quantity) allReturned = false;
    }
    for (const r of returnItems) {
      const oi = byId.get(r.orderItemId);
      if (!oi || oi.quantity <= 0) continue;
      const frac = D(r.quantity).div(oi.quantity);
      const lineGross = D(oi.totalPrice).add(oi.taxAmount).sub(oi.discountAmount);
      total = total.add(lineGross.mul(frac));
    }
    if (RETURN_REFUND_INCLUDE_SHIPPING && allReturned) {
      total = total.add(so.shippingAmount);
    }
    return round2(Number(total.toFixed(2)));
  }

  private sellerOrderGross(so: {
    subtotal: Prisma.Decimal;
    taxAmount: Prisma.Decimal;
    shippingAmount: Prisma.Decimal;
    discountAmount: Prisma.Decimal;
  }): Prisma.Decimal {
    return D(so.subtotal).add(so.taxAmount).add(so.shippingAmount).sub(so.discountAmount);
  }

  private async returnedQtyByOrderItem(
    sellerOrderId: string,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<Map<string, number>> {
    const rows = await db.returnItem.findMany({
      where: {
        returnRequest: {
          sellerOrderId,
          status: { notIn: [ReturnStatus.REJECTED, ReturnStatus.QC_FAILED] },
        },
      },
      select: { orderItemId: true, quantity: true },
    });
    const out = new Map<string, number>();
    for (const r of rows) {
      out.set(r.orderItemId, (out.get(r.orderItemId) ?? 0) + r.quantity);
    }
    return out;
  }

  private async loadDetail(id: string) {
    const rr = await this.prisma.returnRequest.findUnique({
      where: { id },
      include: { items: true, events: { orderBy: { createdAt: 'asc' } } },
    });
    if (!rr) throw new NotFoundException('Return not found.');
    return rr;
  }

  private async requireReturn(id: string) {
    const rr = await this.prisma.returnRequest.findUnique({ where: { id } });
    if (!rr) throw new NotFoundException('Return not found.');
    return rr;
  }

  private async notifyCustomer(
    id: string,
    type: string,
    title: string,
    note?: string,
  ): Promise<void> {
    const rr = await this.prisma.returnRequest.findUnique({ where: { id } });
    if (!rr) return;
    const customer = await this.prisma.customer.findUnique({
      where: { id: rr.customerId },
      select: { userId: true },
    });
    if (!customer?.userId) return;
    await this.notifications?.create({
      userId: customer.userId,
      type,
      title,
      body: note
        ? `${title}: ${note} (${rr.returnNumber})`
        : `${title} (${rr.returnNumber})`,
      data: { returnId: rr.id, returnNumber: rr.returnNumber, link: `/account/returns/${rr.id}` },
      dedupeKey: `notif:${type}:${rr.id}`,
    });
  }

  private async getCustomerId(userId: string): Promise<string> {
    const customer = await this.prisma.customer.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!customer) {
      throw new ForbiddenException('Only customer accounts can open returns.');
    }
    return customer.id;
  }

  private async getSellerId(userId: string): Promise<string> {
    const seller = await this.prisma.seller.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!seller) {
      throw new ForbiddenException('You must complete seller onboarding first.');
    }
    return seller.id;
  }

  private async sellerUserId(sellerId: string): Promise<string | null> {
    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
      select: { userId: true },
    });
    return seller?.userId ?? null;
  }
}
