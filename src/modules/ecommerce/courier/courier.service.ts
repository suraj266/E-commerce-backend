/**
 * Courier orchestration: live rates (B3), fulfillment (B4), webhook/tracking
 * (B5). Sits between the shipping/order pipeline and the per-seller provider
 * adapters. All provider calls go through CourierAccountService.getValidContext
 * so tokens are always fresh.
 */

import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CourierProvider, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { EmailService } from '@/modules/admin/email/email.service';
import { SiteSettingService } from '@/modules/admin/site-setting/site-setting.service';
import { OutboxService } from '@/modules/outbox/outbox.service';
import { OUTBOX_QUEUE, OUTBOX_EVENT } from '@/modules/outbox/outbox.constants';
import { config as appConfig } from '@/common/config/config';
import { timingSafeEqualStr } from '@/common/crypto/timing-safe.util';
import { parseShippingConfig } from '@/modules/ecommerce/shipping/shipping-rate';
import { SellerOrderService } from '@/modules/ecommerce/order/seller-order.service';
import { NotificationService } from '@/modules/notification/notification.service';
import { ReturnsService } from '@/modules/ecommerce/returns/returns.service';
import { CourierAccountService } from './courier-account.service';
import { CourierRateCacheService } from './courier-rate-cache.service';
import {
  CreateShipmentRequest,
  NormalizedStatus,
  RateQuote,
  ShipmentAddress,
} from './providers/courier-provider.interface';
import { DEFAULT_BOX_CM, DEFAULT_RATE_TIMEOUT_MS } from './courier.constants';

/**
 * SiteSetting key for the operations alert inbox that receives courier NDR/RTO
 * exceptions (alongside the seller). Admin-configurable so ops routing can
 * change without a redeploy — resolved via SiteSettingService.findByKey.
 */
const OPS_ALERT_EMAIL_SETTING_KEY = 'ops_alert_email';

/**
 * Fallback ops alert inbox used only when the `ops_alert_email` SiteSetting is
 * unset. Intentionally EMPTY so we never blast a bogus placeholder address: an
 * unconfigured ops inbox degrades to "seller only" rather than bouncing the
 * whole alert. The seller still gets the alert; ops joins once configured.
 *
 * // NEEDS-CONFIG: ops alert email — set the `ops_alert_email` SiteSetting (or
 * // replace this constant) with the real operations inbox before go-live.
 */
const DEFAULT_OPS_ALERT_EMAIL = '';

export interface ResolvedRate {
  provider: CourierProvider;
  courierId: string;
  courierName: string;
  /** ₹, tax-inclusive (the GST back-calc treats it as such). */
  rate: number;
  estimatedDays: number | null;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('courier rate timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

@Injectable()
export class CourierService {
  private readonly logger = new Logger(CourierService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: CourierAccountService,
    private readonly cache: CourierRateCacheService,
    private readonly config: ConfigService,
    // OutboxService is @Global (OutboxCoreModule) — no module import needed.
    // EmailService + SiteSettingService require CourierModule to import
    // EmailModule + SiteSettingModule (see CENTRAL-WIRING TODO in the report).
    private readonly outbox: OutboxService,
    private readonly email: EmailService,
    private readonly siteSettings: SiteSettingService,
    @Inject(forwardRef(() => SellerOrderService))
    private readonly sellerOrders: SellerOrderService,
    // @Global NotificationService (P3-08). Optional trailing param so any
    // positional construction stays valid; Nest always injects it in the running
    // app. Writes the seller user's NDR/RTO bell entry alongside the courier
    // alert email — best-effort, guarded with `?.`. See P3-08.
    private readonly notifications?: NotificationService,
    // P3-02: correlate a REVERSE-pickup courier scan back to a ReturnRequest.
    // forwardRef + @Optional — ReturnsModule imports CourierModule for
    // createReturnShipment, and CourierModule imports ReturnsModule for this
    // webhook edge, so the cycle is broken with forwardRef on both sides.
    @Optional()
    @Inject(forwardRef(() => ReturnsService))
    private readonly returns?: ReturnsService,
  ) {}

  private get timeoutMs(): number {
    const raw = Number(this.config.get('COURIER_RATE_TIMEOUT_MS'));
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RATE_TIMEOUT_MS;
  }

  /** Default-warehouse pincode for a store, falling back to shippingConfig.originPincode. */
  private async resolvePickupPincode(storeId: string): Promise<string | null> {
    const wh = await this.prisma.warehouse.findFirst({
      where: { storeId, isDefault: true, isActive: true, deletedAt: null },
      select: { postalCode: true },
    });
    if (wh?.postalCode && /^[1-9][0-9]{5}$/.test(wh.postalCode))
      return wh.postalCode;
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { shippingConfig: true },
    });
    const origin = parseShippingConfig(store?.shippingConfig).originPincode;
    return origin && /^[1-9][0-9]{5}$/.test(origin) ? origin : null;
  }

  /**
   * Live rate for one seller-order, or null → caller falls back to the in-house
   * engine. Never throws: any provider error/timeout/no-courier resolves to null.
   */
  async resolveSellerRate(args: {
    sellerId: string;
    storeId: string;
    deliveryPincode: string;
    billableWeightKg: number;
    declaredValue: number;
    cod: boolean;
  }): Promise<ResolvedRate | null> {
    try {
      const account = await this.accounts.getEnabledAccount(args.sellerId);
      if (!account) return null;

      const pickupPincode = await this.resolvePickupPincode(args.storeId);
      if (!pickupPincode) return null;

      const cacheKey = this.cache.key({
        provider: account.provider,
        pickupPincode,
        deliveryPincode: args.deliveryPincode,
        weightKg: args.billableWeightKg,
        cod: args.cod,
      });
      const cached = this.cache.get<ResolvedRate | 'NONE'>(cacheKey);
      if (cached) return cached === 'NONE' ? null : cached;

      const impl = this.accounts.getProvider(account.provider);
      const { context } = await this.accounts.getValidContext(account.id);
      const rates = await withTimeout(
        impl.getRates(context, {
          pickupPincode,
          deliveryPincode: args.deliveryPincode,
          weightKg: args.billableWeightKg,
          declaredValue: args.declaredValue,
          cod: args.cod,
        }),
        this.timeoutMs,
      );

      const chosen = this.pickCourier(rates, args.cod);
      if (!chosen) {
        this.cache.set(cacheKey, 'NONE');
        return null;
      }
      const result: ResolvedRate = {
        provider: account.provider,
        courierId: chosen.providerCourierId,
        courierName: chosen.courierName,
        rate: chosen.rate,
        estimatedDays: chosen.estimatedDays,
      };
      this.cache.set(cacheKey, result);
      return result;
    } catch (e) {
      this.logger.warn(
        `Live rate failed for seller ${args.sellerId} → in-house fallback: ${(e as Error).message}`,
      );
      return null;
    }
  }

  /** Prefer the provider's recommended courier; else the cheapest serviceable one. */
  private pickCourier(rates: RateQuote[], cod: boolean): RateQuote | null {
    const usable = rates.filter(
      (r) => r.serviceable && (!cod || r.codAvailable),
    );
    if (usable.length === 0) return null;
    return (
      usable.find((r) => r.recommended) ??
      usable.reduce((a, b) => (b.rate < a.rate ? b : a))
    );
  }

  // ---------------------------------------------------------------------------
  // Pickup locations (fetch from the provider account; seller selects one)
  // ---------------------------------------------------------------------------

  async listPickupLocations(userId: string, provider: CourierProvider) {
    const sellerId = await this.sellerIdOf(userId);
    const account = await this.accounts.getEnabledAccount(sellerId);
    if (!account || account.provider !== provider) {
      throw new BadRequestException(
        'Connect this courier before fetching pickup locations.',
      );
    }
    const impl = this.accounts.getProvider(provider);
    const { context } = await this.accounts.getValidContext(account.id);
    return impl.listPickupLocations(context);
  }

  // ---------------------------------------------------------------------------
  // Order created in the provider dashboard at CONFIRM (two-phase flow)
  // ---------------------------------------------------------------------------

  /**
   * Push the order to the courier as a "New Order" the moment the seller
   * confirms — so it appears in their courier dashboard before a courier is
   * even chosen. Fire-and-forget, idempotent, never throws.
   */
  async createOrderAtConfirm(sellerOrderId: string): Promise<void> {
    try {
      const so = await this.loadSellerOrder(sellerOrderId);
      if (!so || so.shipmentId) return; // already pushed
      const account = await this.accounts.getEnabledAccount(so.sellerId);
      if (!account || !account.pickupLocationNickname) return; // not connected / no pickup
      const impl = this.accounts.getProvider(account.provider);
      const { context } = await this.accounts.getValidContext(account.id);
      const created = await impl.createShipment(
        context,
        this.buildShipmentRequest(so, account),
      );
      await this.prisma.sellerOrder.update({
        where: { id: so.id },
        data: {
          shipmentId: created.providerShipmentId,
          providerOrderId: created.providerOrderId,
          shippingProvider: account.provider,
        },
      });
      this.logger.log(
        `Pushed ${so.orderNumber} to ${account.provider} (shipment ${created.providerShipmentId}).`,
      );
    } catch (e) {
      this.logger.warn(
        `createOrderAtConfirm failed for ${sellerOrderId}: ${(e as Error).message}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Reverse pickup (P3-02 returns) — generate a reverse AWB for a return.
  // ---------------------------------------------------------------------------

  /**
   * Create a REVERSE (return) shipment for a seller-order: the courier collects
   * from the buyer and returns to the seller warehouse. Returns null when the
   * seller has no connected courier (the caller falls back to a manual pickup).
   * ALL provider HTTP happens here, OUTSIDE any DB transaction — the caller
   * persists the reverse AWB/shipment id afterwards.
   */
  async createReturnShipment(args: {
    sellerOrderId: string;
    returnNumber: string;
  }): Promise<{
    provider: string;
    reverseShipmentId: string;
    reverseProviderOrderId: string;
    reverseAwb: string | null;
    courierName: string | null;
    reverseLabelUrl: string | null;
  } | null> {
    const so = await this.loadSellerOrder(args.sellerOrderId);
    if (!so) throw new NotFoundException('Order not found.');
    const account = await this.accounts.getEnabledAccount(so.sellerId);
    if (!account || !account.pickupLocationNickname) return null; // manual pickup

    const addr = so.order.shippingAddress;
    if (!addr) {
      throw new BadRequestException(
        'Order has no shipping address for the reverse pickup.',
      );
    }
    const buyer: ShipmentAddress = {
      name: addr.firstName,
      lastName: addr.lastName,
      phone: (addr.phone ?? '').replace(/\D/g, '').slice(-10),
      addressLine1: addr.addressLine1,
      addressLine2: addr.addressLine2,
      city: addr.city,
      state: addr.state,
      pincode: addr.postalCode,
      country: addr.countryCode === 'IN' ? 'India' : addr.countryCode,
    };

    // Return-to = the store's default warehouse.
    const wh = await this.prisma.warehouse.findFirst({
      where: { storeId: so.storeId, isDefault: true, isActive: true, deletedAt: null },
    });
    if (!wh) {
      throw new BadRequestException(
        'The store has no default warehouse to receive the return.',
      );
    }
    const seller: ShipmentAddress = {
      name: wh.name,
      phone: (wh.phone ?? '').replace(/\D/g, '').slice(-10),
      addressLine1: wh.addressLine1,
      addressLine2: wh.addressLine2,
      city: wh.city,
      state: wh.state,
      pincode: wh.postalCode,
      country: wh.countryCode === 'IN' ? 'India' : wh.countryCode,
    };

    const impl = this.accounts.getProvider(account.provider);
    const { context } = await this.accounts.getValidContext(account.id);

    const created = await impl.createReturnShipment(context, {
      orderNumber: so.orderNumber,
      returnNumber: args.returnNumber,
      orderDate: new Date(),
      pickupLocationNickname: account.pickupLocationNickname,
      customer: buyer,
      seller,
      items: so.items.map((it) => ({
        name: it.name,
        sku: it.sku,
        units: it.quantity,
        sellingPrice: Number(it.unitPrice),
        hsn: it.hsnCode ?? undefined,
      })),
      subTotal: Number(so.subtotal),
      weightKg: so.billableWeightKg ? Number(so.billableWeightKg) : 0.5,
      dimensionsCm: DEFAULT_BOX_CM,
    });

    let reverseAwb: string | null = null;
    let courierName: string | null = null;
    try {
      const awb = await impl.assignAwb(context, created.providerShipmentId);
      reverseAwb = awb.awbCode;
      courierName = awb.courierName;
    } catch (e) {
      this.logger.warn(
        `Reverse AWB assignment failed for return ${args.returnNumber}: ${(e as Error).message}`,
      );
    }
    let reverseLabelUrl: string | null = null;
    try {
      reverseLabelUrl = (
        await impl.getLabel(context, created.providerShipmentId)
      ).labelUrl;
    } catch (e) {
      this.logger.warn(
        `Reverse label generation failed for return ${args.returnNumber}: ${(e as Error).message}`,
      );
    }

    return {
      provider: account.provider,
      reverseShipmentId: created.providerShipmentId,
      reverseProviderOrderId: created.providerOrderId,
      reverseAwb,
      courierName,
      reverseLabelUrl,
    };
  }

  // ---------------------------------------------------------------------------
  // Courier options (live serviceability list shown in the ship-time picker)
  // ---------------------------------------------------------------------------

  async getCourierOptions(userId: string, sellerOrderId: string) {
    const so = await this.loadSellerOrder(sellerOrderId);
    if (!so) throw new NotFoundException('Order not found.');
    if (so.seller.userId !== userId)
      throw new BadRequestException('You do not own this order.');
    const account = await this.accounts.getEnabledAccount(so.sellerId);
    if (!account) throw new BadRequestException('No courier connected.');

    const pickupPincode = await this.resolvePickupPincode(so.storeId);
    const deliveryPincode = so.order.shippingAddress?.postalCode ?? '';
    if (!pickupPincode || !/^[1-9][0-9]{5}$/.test(deliveryPincode)) {
      throw new BadRequestException(
        'Valid pickup + delivery pincodes are required to list couriers.',
      );
    }
    const impl = this.accounts.getProvider(account.provider);
    const { context } = await this.accounts.getValidContext(account.id);
    const couriers = await impl.getRates(context, {
      pickupPincode,
      deliveryPincode,
      weightKg: so.billableWeightKg ? Number(so.billableWeightKg) : 0.5,
      declaredValue: Number(so.subtotal),
      cod: so.paymentStatus !== 'PAID',
    });
    return {
      couriers,
      selectedCourierId: so.selectedCourierId ?? null,
      selectedCourierName: so.selectedCourierName ?? null,
    };
  }

  // ---------------------------------------------------------------------------
  // Fulfillment: assign the chosen courier → AWB → pickup → label → SHIPPED
  // ---------------------------------------------------------------------------

  async shipViaCourier(
    userId: string,
    sellerOrderId: string,
    courierId: string,
  ) {
    const so = await this.loadSellerOrder(sellerOrderId);
    if (!so) throw new NotFoundException('Order not found.');
    if (so.seller.userId !== userId)
      throw new BadRequestException('You do not own this order.');
    if (so.status !== OrderStatus.PACKED) {
      throw new BadRequestException(
        'Mark the order PACKED before shipping with a courier.',
      );
    }
    if (!courierId)
      throw new BadRequestException('Select a courier to ship with.');

    const account = await this.accounts.getEnabledAccount(so.sellerId);
    if (!account) {
      throw new BadRequestException(
        'No courier connected. Use manual shipping instead.',
      );
    }
    if (!account.pickupLocationNickname) {
      throw new BadRequestException(
        'Select a pickup location for your courier first (Shipping → Manage).',
      );
    }

    const impl = this.accounts.getProvider(account.provider);
    const { context } = await this.accounts.getValidContext(account.id);

    // The order was usually created in the dashboard at confirm; create now if
    // not (idempotent resume).
    let providerShipmentId = so.shipmentId;
    let providerOrderId = so.providerOrderId;
    if (!providerShipmentId) {
      const created = await impl.createShipment(
        context,
        this.buildShipmentRequest(so, account),
      );
      providerShipmentId = created.providerShipmentId;
      providerOrderId = created.providerOrderId;
      await this.prisma.sellerOrder.update({
        where: { id: so.id },
        data: {
          shipmentId: providerShipmentId,
          providerOrderId,
          shippingProvider: account.provider,
        },
      });
    }

    const awb = await impl.assignAwb(context, providerShipmentId, courierId);

    let labelUrl: string | null = null;
    try {
      await impl.schedulePickup(context, providerShipmentId);
    } catch (e) {
      this.logger.warn(
        `Pickup scheduling failed for ${so.orderNumber}: ${(e as Error).message}`,
      );
    }
    try {
      labelUrl = (await impl.getLabel(context, providerShipmentId)).labelUrl;
    } catch (e) {
      this.logger.warn(
        `Label generation failed for ${so.orderNumber}: ${(e as Error).message}`,
      );
    }

    return this.sellerOrders.markShippedFromCourier(userId, so.id, {
      awbCode: awb.awbCode,
      courierName: awb.courierName,
      trackingUrl: null,
      labelUrl,
      shipmentId: providerShipmentId,
      providerOrderId,
      shippingProvider: account.provider,
    });
  }

  // ---------------------------------------------------------------------------
  // Shared helpers
  // ---------------------------------------------------------------------------

  private async sellerIdOf(userId: string): Promise<string> {
    const seller = await this.prisma.seller.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!seller)
      throw new BadRequestException(
        'You must complete seller onboarding first.',
      );
    return seller.id;
  }

  private loadSellerOrder(sellerOrderId: string) {
    return this.prisma.sellerOrder.findUnique({
      where: { id: sellerOrderId },
      include: {
        items: true,
        seller: true,
        store: true,
        order: { include: { shippingAddress: true } },
      },
    });
  }

  /** Build the provider shipment payload from a loaded SellerOrder (+address validation). */
  private buildShipmentRequest(
    so: NonNullable<Awaited<ReturnType<CourierService['loadSellerOrder']>>>,
    account: { pickupLocationNickname: string | null },
  ): CreateShipmentRequest {
    const addr = so.order.shippingAddress;
    if (!addr) throw new BadRequestException('Order has no shipping address.');
    const shipping: ShipmentAddress = {
      name: addr.firstName,
      lastName: addr.lastName,
      phone: (addr.phone ?? '').replace(/\D/g, '').slice(-10),
      addressLine1: addr.addressLine1,
      addressLine2: addr.addressLine2,
      city: addr.city,
      state: addr.state,
      pincode: addr.postalCode,
      country: addr.countryCode === 'IN' ? 'India' : addr.countryCode,
    };
    if (!/^[0-9]{10}$/.test(shipping.phone)) {
      throw new BadRequestException(
        'A valid 10-digit delivery phone number is required by the courier.',
      );
    }
    if (!/^[1-9][0-9]{5}$/.test(shipping.pincode)) {
      throw new BadRequestException(
        'A valid 6-digit delivery pincode is required by the courier.',
      );
    }
    return {
      orderNumber: so.orderNumber,
      orderDate: so.createdAt,
      pickupLocationNickname: account.pickupLocationNickname as string,
      billing: shipping,
      shipping,
      items: so.items.map((it) => ({
        name: it.name,
        sku: it.sku,
        units: it.quantity,
        sellingPrice: Number(it.unitPrice),
        hsn: it.hsnCode ?? undefined,
      })),
      paymentMethod: so.paymentStatus === 'PAID' ? 'Prepaid' : 'COD',
      subTotal: Number(so.subtotal),
      weightKg: so.billableWeightKg ? Number(so.billableWeightKg) : 0.5,
      dimensionsCm: DEFAULT_BOX_CM,
      preferredCourierId: so.selectedCourierId,
    };
  }

  // ---------------------------------------------------------------------------
  // B5 — Webhook tracking
  // ---------------------------------------------------------------------------

  /**
   * Provider-agnostic inbound tracking webhook. One open `/webhooks/courier`
   * endpoint serves every seller + provider: we parse the AWB generically,
   * correlate awb/order → SellerOrder → that seller's account → its provider,
   * then normalize fully and verify the `x-api-key` against the account's
   * webhookSecret (the token the seller configured in their courier panel).
   */
  async handleWebhook(rawBody: unknown, apiKey: string): Promise<void> {
    const body = (rawBody ?? {}) as Record<string, any>;
    const rawAwb = body.awb ?? body.awb_code ?? null;
    const awb = rawAwb != null ? String(rawAwb) : null;
    const rawOrderId = body.order_id ?? null;
    const providerOrderId = rawOrderId != null ? String(rawOrderId) : null;

    // Correlate first (generic) → we need the SellerOrder to know the provider.
    const so = await this.prisma.sellerOrder.findFirst({
      where: {
        deletedAt: null,
        OR: [
          ...(awb ? [{ awbCode: awb }] : []),
          ...(providerOrderId ? [{ providerOrderId }] : []),
        ],
      },
    });
    if (!so) {
      // Might be a REVERSE-pickup scan for a ReturnRequest (P3-02): the SellerOrder
      // carries the FORWARD AWB, so a reverse AWB never matches above.
      const handledReverse = await this.tryReverseReturnWebhook(awb, body, apiKey);
      if (!handledReverse) {
        this.logger.warn(
          `Courier webhook unmatched (awb=${awb} order=${providerOrderId})`,
        );
      }
      return;
    }

    const account = await this.accounts.getEnabledAccount(so.sellerId);
    if (!account) return;
    const impl = this.accounts.getProvider(account.provider);
    const evt = impl.normalizeWebhook(rawBody);

    // Authenticate BEFORE writing anything. A missing webhookSecret fails closed
    // (previously an empty secret trusted any caller), and the token compare is
    // constant-time. Verifying before the dedupe insert also stops an
    // unauthenticated caller from occupying the process-once dedupeKey and
    // suppressing a later legitimate event.
    if (!account.webhookSecret) {
      this.logger.warn(
        `Courier account for seller ${so.sellerId} has no webhookSecret configured — rejecting webhook for ${so.orderNumber}`,
      );
      return;
    }
    if (!timingSafeEqualStr(account.webhookSecret, apiKey)) {
      this.logger.warn(
        `Courier webhook signature mismatch for ${so.orderNumber}`,
      );
      return;
    }

    // Idempotency: unique dedupeKey → process exactly once (authenticated only).
    try {
      await this.prisma.courierWebhookLog.create({
        data: {
          provider: account.provider,
          sellerOrderId: so.id,
          awbCode: evt.awbCode ?? awb,
          providerOrderId: evt.providerOrderId ?? providerOrderId,
          rawStatusCode: evt.rawStatusCode,
          normalizedStatus: evt.normalizedStatus,
          dedupeKey: evt.dedupeKey,
          payload: body,
          signatureValid: true,
          processedAt: new Date(),
        },
      });
    } catch {
      return; // duplicate event
    }

    await this.applyStatus(so.id, evt.normalizedStatus, evt.rawStatusCode);
  }

  /**
   * Correlate an inbound scan to a ReturnRequest by its reverse AWB (P3-02) and
   * advance its lifecycle (PICKED_UP/IN_TRANSIT → IN_TRANSIT; DELIVERED [back at
   * the seller] → RECEIVED). Authenticates the same way as the forward webhook
   * (per-seller webhookSecret) and dedupes via CourierWebhookLog. Returns true if
   * it matched + handled a return, false so the caller can log it unmatched.
   */
  private async tryReverseReturnWebhook(
    awb: string | null,
    body: Record<string, any>,
    apiKey: string,
  ): Promise<boolean> {
    if (!this.returns || !awb) return false;
    const returnsService = this.returns;
    const ret = await this.prisma.returnRequest.findFirst({
      where: { reverseAwb: awb },
    });
    if (!ret) return false;

    const account = await this.accounts.getEnabledAccount(ret.sellerId);
    if (!account) return false;
    const impl = this.accounts.getProvider(account.provider);
    const evt = impl.normalizeWebhook(body);

    // Authenticate before writing anything (fail closed on a missing secret).
    if (!account.webhookSecret) {
      this.logger.warn(
        `Reverse webhook for return ${ret.returnNumber}: seller has no webhookSecret — rejecting.`,
      );
      return false;
    }
    if (!timingSafeEqualStr(account.webhookSecret, apiKey)) {
      this.logger.warn(
        `Reverse webhook signature mismatch for return ${ret.returnNumber}`,
      );
      return false;
    }

    // Idempotency: process each provider event once.
    try {
      await this.prisma.courierWebhookLog.create({
        data: {
          provider: account.provider,
          sellerOrderId: ret.sellerOrderId,
          awbCode: evt.awbCode ?? awb,
          providerOrderId: evt.providerOrderId ?? ret.reverseProviderOrderId,
          rawStatusCode: evt.rawStatusCode,
          normalizedStatus: evt.normalizedStatus,
          dedupeKey: `RETURN|${evt.dedupeKey}`,
          payload: body,
          signatureValid: true,
          processedAt: new Date(),
        },
      });
    } catch {
      return true; // duplicate event — already processed
    }

    let target: 'IN_TRANSIT' | 'RECEIVED' | null = null;
    switch (evt.normalizedStatus) {
      case NormalizedStatus.PICKED_UP:
      case NormalizedStatus.IN_TRANSIT:
      case NormalizedStatus.OUT_FOR_DELIVERY:
        target = 'IN_TRANSIT';
        break;
      case NormalizedStatus.DELIVERED:
        // "Delivered" on a reverse shipment = back with the seller.
        target = 'RECEIVED';
        break;
      default:
        target = null;
    }
    if (target) {
      await returnsService.advanceFromReverseScan(
        ret.id,
        target,
        `Reverse courier: ${evt.rawStatusCode || evt.normalizedStatus}`,
      );
    }
    return true;
  }

  /** Poll-or-webhook status application — maps normalized status to the order machine. */
  async applyStatus(
    sellerOrderId: string,
    status: NormalizedStatus,
    note: string,
  ): Promise<void> {
    let target: OrderStatus | 'NDR' | 'RTO' | null = null;
    switch (status) {
      case NormalizedStatus.PICKED_UP:
      case NormalizedStatus.IN_TRANSIT:
      case NormalizedStatus.OUT_FOR_DELIVERY:
        target = OrderStatus.SHIPPED;
        break;
      case NormalizedStatus.DELIVERED:
        target = OrderStatus.DELIVERED;
        break;
      case NormalizedStatus.CANCELLED:
        target = OrderStatus.CANCELLED;
        break;
      case NormalizedStatus.NDR:
        target = 'NDR';
        break;
      case NormalizedStatus.RTO:
        target = 'RTO';
        break;
      default:
        return;
    }

    // NDR/RTO are courier EXCEPTIONS, not order-status transitions. They own a
    // dedicated durable path here (metadata flag + history note + a deduped
    // alert email committed in ONE transaction) instead of the plain
    // SellerOrderService delegate, whose NDR/RTO branch dropped the alert email.
    if (target === 'NDR' || target === 'RTO') {
      await this.applyCourierExceptionStatus(sellerOrderId, target, note || status);
      return;
    }

    await this.sellerOrders.applyCourierStatus(
      sellerOrderId,
      target,
      note || status,
    );
  }

  /**
   * Record an NDR (non-delivery report) / RTO (return-to-origin) courier
   * exception and fire the seller + ops alert that `applyCourierStatus` used to
   * drop. NDR/RTO are NOT status changes (SHIPPED→CANCELLED is forbidden) — we
   * flag them as SellerOrder metadata + a history note.
   *
   * Durability: the metadata write and the `email.courier_alert` enqueue share
   * ONE `this.prisma.$transaction`, so "we flagged the exception" and "we owe
   * the alert" commit or roll back together (OutboxService.enqueue must be
   * called with the tx client). Idempotent: a daily tracking re-poll of a
   * still-flagged order is a no-op, and the dedupeKey makes the alert email fire
   * exactly once per (shipment, status).
   */
  private async applyCourierExceptionStatus(
    sellerOrderId: string,
    kind: 'NDR' | 'RTO',
    note: string,
  ): Promise<void> {
    const flag = kind.toLowerCase(); // 'ndr' | 'rto'
    await this.prisma.$transaction(async (tx) => {
      const so = await tx.sellerOrder.findUnique({
        where: { id: sellerOrderId },
      });
      if (!so || so.deletedAt) return;

      const meta =
        typeof so.metadata === 'object' && so.metadata
          ? (so.metadata as Record<string, unknown>)
          : {};
      // Already flagged (e.g. the daily tracking cron re-polling a stuck NDR
      // order): the alert was enqueued in the same commit that set this flag, so
      // there is nothing left to do — avoids duplicate history notes + re-work.
      if (meta[flag] === true) return;

      const nextMeta = {
        ...meta,
        [flag]: true,
        [`${flag}At`]: new Date().toISOString(),
      } as Prisma.InputJsonValue;

      await tx.sellerOrder.update({
        where: { id: so.id },
        data: { metadata: nextMeta },
      });
      await tx.orderStatusHistory.create({
        data: {
          sellerOrderId: so.id,
          fromStatus: so.status,
          toStatus: so.status,
          notes: `Courier: ${note}`,
        },
      });

      // The seller + ops NDR/RTO alert — previously a promised-but-dropped
      // email — is now a durable OutboxEvent committed atomically with the
      // exception flag. Routed on the COURIER queue (CourierProcessor dispatches
      // to sendCourierAlertEmail); the worker re-reads canonical state + sends.
      await this.outbox.enqueue(tx, {
        type: OUTBOX_EVENT.EMAIL_COURIER_ALERT,
        queue: OUTBOX_QUEUE.COURIER,
        payload: { sellerOrderId: so.id, status: kind },
        dedupeKey: `email:courier_alert:${so.shipmentId ?? so.id}:${kind}`,
      });

      // P3-08: the seller's in-app NDR/RTO bell entry is written inside the
      // outbox worker handler (sendCourierAlertEmail below), keyed idempotently
      // so it rides the SAME durable OutboxEvent enqueued just above — the alert
      // email and the bell entry share one at-least-once delivery + retry.
    });
  }

  /**
   * Send the courier NDR/RTO alert to the seller + the ops inbox. Invoked by the
   * outbox email worker for an `email.courier_alert` event; re-reads the
   * shipment (SellerOrder) + order + seller by id and resolves recipients.
   * Throws on a genuine send failure so the outbox retries; returns cleanly on
   * an intentionally SKIPPED send (SMTP off / template disabled) or when there
   * is no recipient to alert.
   */
  async sendCourierAlertEmail(
    sellerOrderId: string,
    status: 'NDR' | 'RTO',
  ): Promise<void> {
    const so = await this.prisma.sellerOrder.findUnique({
      where: { id: sellerOrderId },
      include: {
        store: { include: { seller: { include: { user: true } } } },
        order: true,
      },
    });
    if (!so) return;

    const seller = so.store?.seller;

    // In-app bell entry for the seller user (before the send; idempotent). Keyed
    // by shipment + status to mirror the courier-alert OutboxEvent's dedupeKey so
    // an NDR and a later RTO both notify, but a redelivered job never duplicates.
    const sellerUserId = seller?.userId ?? null;
    if (sellerUserId) {
      const label =
        status === 'NDR'
          ? 'Non-Delivery Report (NDR)'
          : 'Return to Origin (RTO)';
      await this.notifications?.create({
        userId: sellerUserId,
        type: 'courier_alert',
        title: `Courier alert: ${status}`,
        body: `Order ${so.orderNumber} has a ${label}. Review and take action.`,
        data: {
          sellerOrderId: so.id,
          orderNumber: so.orderNumber,
          status,
          awb: so.awbCode ?? so.trackingNumber ?? null,
          link: `/seller/orders/${so.id}`,
        },
        dedupeKey: `notif:courier_alert:${so.shipmentId ?? so.id}:${status}`,
      });
    }

    const sellerEmail =
      seller?.supportEmail ?? seller?.businessEmail ?? seller?.user?.email ?? null;
    const opsEmail = await this.resolveOpsAlertEmail();

    // Dedupe + drop empties; no valid recipient at all → nothing to alert.
    const recipients = Array.from(
      new Set(
        [sellerEmail, opsEmail].filter(
          (e): e is string => !!e && e.includes('@'),
        ),
      ),
    );
    if (recipients.length === 0) return;

    const statusLabel =
      status === 'NDR'
        ? 'Non-Delivery Report (NDR)'
        : 'Return to Origin (RTO)';
    const nextAction =
      status === 'NDR'
        ? 'The courier could not deliver this shipment. Reconfirm the delivery address / customer availability and reattempt delivery before it is auto-returned.'
        : 'The shipment is being returned to origin. Track the return, arrange to receive the parcel, and reconcile inventory once it is back.';
    const frontendUrl = appConfig.FRONTEND_URL ?? '';

    const result = await this.email.send('courier_alert', recipients.join(', '), {
      sellerName: seller?.displayName ?? seller?.user?.name ?? 'Seller',
      orderNumber: so.orderNumber,
      awb: so.awbCode ?? so.trackingNumber ?? 'N/A',
      carrier: so.carrier ?? so.selectedCourierName ?? 'the courier',
      status,
      statusLabel,
      nextAction,
      trackingLink: so.trackingUrl ?? `${frontendUrl}/seller/orders/${so.id}`,
      orderLink: `${frontendUrl}/seller/orders/${so.id}`,
    });
    if (!result.sent && !result.skipped) {
      throw new Error(`courier_alert email failed: ${result.message}`);
    }
  }

  /**
   * Resolve the operations alert inbox. Prefers the admin-configurable
   * `ops_alert_email` SiteSetting so ops routing changes without a redeploy;
   * falls back to DEFAULT_OPS_ALERT_EMAIL (empty by default → ops omitted).
   * Never throws — a settings read error degrades to the constant so the
   * seller's alert is still attempted.
   */
  private async resolveOpsAlertEmail(): Promise<string | null> {
    try {
      const setting = await this.siteSettings.findByKey(
        OPS_ALERT_EMAIL_SETTING_KEY,
      );
      const value = setting?.value?.trim();
      if (value && value.includes('@')) return value;
    } catch (e) {
      this.logger.warn(
        `Could not read ${OPS_ALERT_EMAIL_SETTING_KEY} setting: ${(e as Error).message}`,
      );
    }
    const fallback = DEFAULT_OPS_ALERT_EMAIL.trim();
    return fallback && fallback.includes('@') ? fallback : null;
  }
}
