import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '@/prisma/prisma.service';
import { InvoiceService } from '@/modules/ecommerce/invoice/invoice.service';
import { OrderPlacementService } from '@/modules/ecommerce/order/order-placement.service';
import { RefundService } from '@/modules/ecommerce/payment/refund.service';
import { SellerService } from '@/modules/ecommerce/seller/seller.service';
import { CourierService } from '@/modules/ecommerce/courier/courier.service';
import { PrivacyService } from '@/modules/compliance/privacy/privacy.service';
import { TcsService } from '@/modules/compliance/tcs/tcs.service';
import { NewsletterService } from '@/modules/cms/newsletter/newsletter.service';
import { ReturnsService } from '@/modules/ecommerce/returns/returns.service';
import { GrievanceService } from '@/modules/compliance/grievance/grievance.service';
import { BackInStockService } from '@/modules/notification/back-in-stock.service';
import { NOTIFICATION_OUTBOX_EVENT } from '@/modules/notification/notification.constants';
import { OUTBOX_EVENT, OUTBOX_QUEUE } from './outbox.constants';
import {
  OutboxExecutionService,
  OutboxEventView,
} from './outbox-execution.service';

/**
 * BullMQ job payload the relay writes: just the outbox row id. The handler
 * re-loads the row (and its own domain state) — the queue is a transport, the
 * DB is the source of truth.
 */
interface OutboxJobData {
  outboxId: string;
}

/**
 * One `WorkerHost` per named queue. Each `process` defers the DONE / retry /
 * FAILED bookkeeping to `OutboxExecutionService` and only supplies the domain
 * handler (dispatched on the event's exact `type`). Handlers must be idempotent
 * — a job may be delivered more than once (at-least-once semantics).
 */

@Processor(OUTBOX_QUEUE.INVOICES)
export class InvoicesProcessor extends WorkerHost {
  constructor(
    private readonly exec: OutboxExecutionService,
    private readonly invoice: InvoiceService,
  ) {
    super();
  }

  async process(job: Job<OutboxJobData>): Promise<void> {
    await this.exec.process(job.data.outboxId, async (event: OutboxEventView) => {
      switch (event.type) {
        case OUTBOX_EVENT.INVOICE_GENERATE:
          await this.invoice.generateForSellerOrder(event.payload.sellerOrderId);
          return;
        default:
          throw new Error(`Unknown invoices outbox type: ${event.type}`);
      }
    });
  }
}

@Processor(OUTBOX_QUEUE.CART)
export class CartProcessor extends WorkerHost {
  constructor(
    private readonly exec: OutboxExecutionService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job<OutboxJobData>): Promise<void> {
    await this.exec.process(job.data.outboxId, async (event: OutboxEventView) => {
      switch (event.type) {
        case OUTBOX_EVENT.CART_CLEAR:
          await this.clearCart(event.payload.orderId);
          return;
        default:
          throw new Error(`Unknown cart outbox type: ${event.type}`);
      }
    });
  }

  /**
   * Empty the buyer's cart after a prepaid capture (prepaid orders keep the cart
   * until payment succeeds so a cancelled payment leaves it intact for retry).
   * Idempotent: deleting already-empty CartItems is a no-op.
   */
  private async clearCart(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { customerId: true },
    });
    if (!order) return;
    const cart = await this.prisma.cart.findUnique({
      where: { customerId: order.customerId },
      select: { id: true },
    });
    if (!cart) return;
    await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
  }
}

@Processor(OUTBOX_QUEUE.EMAILS)
export class EmailsProcessor extends WorkerHost {
  constructor(
    private readonly exec: OutboxExecutionService,
    private readonly orderPlacement: OrderPlacementService,
    private readonly refund: RefundService,
    private readonly seller: SellerService,
    private readonly privacy: PrivacyService,
    private readonly tcs: TcsService,
    private readonly newsletter: NewsletterService,
    private readonly returns: ReturnsService,
    // P4 (CP-EC grievance): status/reply/filed lifecycle emails + in-app bell.
    private readonly grievance: GrievanceService,
    // P4 (notification depth): wishlist back-in-stock alert. Optional trailing
    // param — BackInStockService is a @Global NotificationModule export, so it
    // resolves at runtime; `?` keeps positional construction safe.
    private readonly backInStock?: BackInStockService,
  ) {
    super();
  }

  async process(job: Job<OutboxJobData>): Promise<void> {
    await this.exec.process(job.data.outboxId, async (event: OutboxEventView) => {
      switch (event.type) {
        case OUTBOX_EVENT.EMAIL_ORDER_PLACED:
          await this.orderPlacement.sendOrderPlacedEmail(event.payload.orderId);
          return;
        case OUTBOX_EVENT.EMAIL_SELLER_NEW_ORDER:
          await this.orderPlacement.sendSellerNewOrderEmail(
            event.payload.sellerOrderId,
          );
          return;
        case OUTBOX_EVENT.EMAIL_ORDER_REFUNDED:
          await this.refund.sendOrderRefundedEmail(event.payload.refundId);
          return;
        case OUTBOX_EVENT.EMAIL_SELLER_KYC_APPROVED:
          await this.seller.sendKycApprovedEmail(event.payload.sellerId);
          return;
        case OUTBOX_EVENT.EMAIL_SELLER_KYC_REJECTED:
          await this.seller.sendKycRejectedEmail(event.payload.sellerId);
          return;
        case OUTBOX_EVENT.PRIVACY_DATA_EXPORT:
          // P3-07 (DPDP): build the signed expiring export bundle URL + email it.
          await this.privacy.buildAndSendDataExport(event.payload.exportRequestId);
          return;
        case OUTBOX_EVENT.TCS_DEPOSIT_REMINDER:
          // P3-03 (TCS): remind ops of the outstanding monthly deposit.
          await this.tcs.sendDepositReminderEmail(event.payload.period);
          return;
        case OUTBOX_EVENT.NEWSLETTER_CONFIRM:
          // P3-08: send the newsletter double opt-in confirmation email.
          await this.newsletter.sendNewsletterConfirmEmail(
            event.payload.subscriptionId,
          );
          return;
        case OUTBOX_EVENT.NEWSLETTER_CAMPAIGN_SEND:
          // P3 Wave 4: fan a broadcast campaign out over ACTIVE subscribers
          // (consent-gated), enqueuing one delivery event per surviving recipient.
          await this.newsletter.dispatchCampaign(event.payload.campaignId);
          return;
        case OUTBOX_EVENT.NEWSLETTER_CAMPAIGN_DELIVER:
          // P3 Wave 4: send one recipient's copy of the broadcast (unsubscribe-aware).
          await this.newsletter.deliverCampaignEmail(
            event.payload.campaignId,
            event.payload.subscriptionId,
          );
          return;
        case OUTBOX_EVENT.EMAIL_RETURN_APPROVED:
          // P3-02: return approved → customer email + in-app bell.
          await this.returns.sendReturnApprovedEmail(event.payload.returnId);
          return;
        case OUTBOX_EVENT.EMAIL_RETURN_RECEIVED:
          await this.returns.sendReturnReceivedEmail(event.payload.returnId);
          return;
        case OUTBOX_EVENT.EMAIL_RETURN_REFUNDED:
          await this.returns.sendReturnRefundedEmail(event.payload.returnId);
          return;
        case OUTBOX_EVENT.EMAIL_RETURN_REPLACEMENT_APPROVED:
          await this.returns.sendReturnReplacementApprovedEmail(
            event.payload.returnId,
          );
          return;
        case OUTBOX_EVENT.EMAIL_RETURN_REPLACEMENT_SHIPPED:
          await this.returns.sendReturnReplacementShippedEmail(
            event.payload.returnId,
          );
          return;
        case OUTBOX_EVENT.EMAIL_GRIEVANCE_FILED:
          // P4 (CP-EC): complaint filed → acknowledge to the complainant.
          await this.grievance.sendGrievanceFiledEmail(event.payload.grievanceId);
          return;
        case OUTBOX_EVENT.EMAIL_GRIEVANCE_STATUS:
          await this.grievance.sendGrievanceStatusEmail(
            event.payload.grievanceId,
            event.payload.status,
            event.payload.occurrence,
          );
          return;
        case OUTBOX_EVENT.EMAIL_GRIEVANCE_REPLY:
          await this.grievance.sendGrievanceReplyEmail(
            event.payload.grievanceId,
            event.payload.messageId,
          );
          return;
        case NOTIFICATION_OUTBOX_EVENT.BACK_IN_STOCK:
          // P4 (notification depth): wishlist restock alert — in-app bell
          // (auto-fans SMS/push) + email. Routed on the EMAILS queue.
          await this.backInStock?.sendBackInStockAlert(event.payload);
          return;
        default:
          throw new Error(`Unknown emails outbox type: ${event.type}`);
      }
    });
  }
}

/**
 * Courier queue processor. Handles courier-domain side effects — currently the
 * P3-11 NDR/RTO exception alert email (kept off the emails queue so a courier
 * carrier outage retries in its own lane without starving order/refund mail).
 */
@Processor(OUTBOX_QUEUE.COURIER)
export class CourierProcessor extends WorkerHost {
  constructor(
    private readonly exec: OutboxExecutionService,
    private readonly courier: CourierService,
  ) {
    super();
  }

  async process(job: Job<OutboxJobData>): Promise<void> {
    await this.exec.process(job.data.outboxId, async (event: OutboxEventView) => {
      switch (event.type) {
        case OUTBOX_EVENT.EMAIL_COURIER_ALERT:
          await this.courier.sendCourierAlertEmail(
            event.payload.sellerOrderId,
            event.payload.status,
          );
          return;
        default:
          throw new Error(`Unknown courier outbox type: ${event.type}`);
      }
    });
  }
}
