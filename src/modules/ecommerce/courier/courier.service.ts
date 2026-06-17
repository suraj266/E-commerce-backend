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
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CourierProvider, OrderStatus } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { parseShippingConfig } from '@/modules/ecommerce/shipping/shipping-rate';
import { SellerOrderService } from '@/modules/ecommerce/order/seller-order.service';
import { CourierAccountService } from './courier-account.service';
import { CourierRateCacheService } from './courier-rate-cache.service';
import {
  CreateShipmentRequest,
  NormalizedStatus,
  RateQuote,
  ShipmentAddress,
} from './providers/courier-provider.interface';
import { DEFAULT_BOX_CM, DEFAULT_RATE_TIMEOUT_MS } from './courier.constants';

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
    @Inject(forwardRef(() => SellerOrderService))
    private readonly sellerOrders: SellerOrderService,
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
    if (wh?.postalCode && /^[1-9][0-9]{5}$/.test(wh.postalCode)) return wh.postalCode;
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
    const usable = rates.filter((r) => r.serviceable && (!cod || r.codAvailable));
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
      throw new BadRequestException('Connect this courier before fetching pickup locations.');
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
      const created = await impl.createShipment(context, this.buildShipmentRequest(so, account));
      await this.prisma.sellerOrder.update({
        where: { id: so.id },
        data: {
          shipmentId: created.providerShipmentId,
          providerOrderId: created.providerOrderId,
          shippingProvider: account.provider,
        },
      });
      this.logger.log(`Pushed ${so.orderNumber} to ${account.provider} (shipment ${created.providerShipmentId}).`);
    } catch (e) {
      this.logger.warn(`createOrderAtConfirm failed for ${sellerOrderId}: ${(e as Error).message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Courier options (live serviceability list shown in the ship-time picker)
  // ---------------------------------------------------------------------------

  async getCourierOptions(userId: string, sellerOrderId: string) {
    const so = await this.loadSellerOrder(sellerOrderId);
    if (!so) throw new NotFoundException('Order not found.');
    if (so.seller.userId !== userId) throw new BadRequestException('You do not own this order.');
    const account = await this.accounts.getEnabledAccount(so.sellerId);
    if (!account) throw new BadRequestException('No courier connected.');

    const pickupPincode = await this.resolvePickupPincode(so.storeId);
    const deliveryPincode = so.order.shippingAddress?.postalCode ?? '';
    if (!pickupPincode || !/^[1-9][0-9]{5}$/.test(deliveryPincode)) {
      throw new BadRequestException('Valid pickup + delivery pincodes are required to list couriers.');
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

  async shipViaCourier(userId: string, sellerOrderId: string, courierId: string) {
    const so = await this.loadSellerOrder(sellerOrderId);
    if (!so) throw new NotFoundException('Order not found.');
    if (so.seller.userId !== userId) throw new BadRequestException('You do not own this order.');
    if (so.status !== OrderStatus.PACKED) {
      throw new BadRequestException('Mark the order PACKED before shipping with a courier.');
    }
    if (!courierId) throw new BadRequestException('Select a courier to ship with.');

    const account = await this.accounts.getEnabledAccount(so.sellerId);
    if (!account) {
      throw new BadRequestException('No courier connected. Use manual shipping instead.');
    }
    if (!account.pickupLocationNickname) {
      throw new BadRequestException('Select a pickup location for your courier first (Shipping → Manage).');
    }

    const impl = this.accounts.getProvider(account.provider);
    const { context } = await this.accounts.getValidContext(account.id);

    // The order was usually created in the dashboard at confirm; create now if
    // not (idempotent resume).
    let providerShipmentId = so.shipmentId;
    let providerOrderId = so.providerOrderId;
    if (!providerShipmentId) {
      const created = await impl.createShipment(context, this.buildShipmentRequest(so, account));
      providerShipmentId = created.providerShipmentId;
      providerOrderId = created.providerOrderId;
      await this.prisma.sellerOrder.update({
        where: { id: so.id },
        data: { shipmentId: providerShipmentId, providerOrderId, shippingProvider: account.provider },
      });
    }

    const awb = await impl.assignAwb(context, providerShipmentId, courierId);

    let labelUrl: string | null = null;
    try {
      await impl.schedulePickup(context, providerShipmentId);
    } catch (e) {
      this.logger.warn(`Pickup scheduling failed for ${so.orderNumber}: ${(e as Error).message}`);
    }
    try {
      labelUrl = (await impl.getLabel(context, providerShipmentId)).labelUrl;
    } catch (e) {
      this.logger.warn(`Label generation failed for ${so.orderNumber}: ${(e as Error).message}`);
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
    const seller = await this.prisma.seller.findUnique({ where: { userId }, select: { id: true } });
    if (!seller) throw new BadRequestException('You must complete seller onboarding first.');
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
      throw new BadRequestException('A valid 10-digit delivery phone number is required by the courier.');
    }
    if (!/^[1-9][0-9]{5}$/.test(shipping.pincode)) {
      throw new BadRequestException('A valid 6-digit delivery pincode is required by the courier.');
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
      this.logger.warn(`Courier webhook unmatched (awb=${awb} order=${providerOrderId})`);
      return;
    }

    const account = await this.accounts.getEnabledAccount(so.sellerId);
    if (!account) return;
    const impl = this.accounts.getProvider(account.provider);
    const evt = impl.normalizeWebhook(rawBody);

    // Idempotency: unique dedupeKey → process exactly once.
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
        },
      });
    } catch {
      return; // duplicate event
    }

    // Verify the token the seller set in their courier panel.
    const signatureValid = !account.webhookSecret || account.webhookSecret === apiKey;
    await this.prisma.courierWebhookLog.update({
      where: { dedupeKey: evt.dedupeKey },
      data: { signatureValid, processedAt: new Date() },
    });
    if (!signatureValid) {
      this.logger.warn(`Courier webhook signature mismatch for ${so.orderNumber}`);
      return;
    }

    await this.applyStatus(so.id, evt.normalizedStatus, evt.rawStatusCode);
  }

  /** Poll-or-webhook status application — maps normalized status to the order machine. */
  async applyStatus(sellerOrderId: string, status: NormalizedStatus, note: string): Promise<void> {
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
    await this.sellerOrders.applyCourierStatus(sellerOrderId, target, note || status);
  }
}
