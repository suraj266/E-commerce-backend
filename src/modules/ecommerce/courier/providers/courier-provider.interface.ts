/**
 * Provider-agnostic courier contract. Shiprocket is the first concrete
 * implementation; MOCK is a deterministic stub for credential-free testing.
 * Add Delhivery/NimbusPost/etc. by implementing this interface and registering
 * the class in COURIER_PROVIDER_MAP — nothing else in the pipeline changes.
 *
 * Providers are STATELESS: token persistence + lazy refresh live in
 * `CourierAccountService`, which hands each call a `CourierContext` carrying the
 * decrypted credentials + a currently-valid token.
 */

import { OrderStatus } from '@prisma/client';

/** DI token for the Map<provider, ICourierProvider> registry. */
export const COURIER_PROVIDER_MAP = 'COURIER_PROVIDER_MAP';

/** Decrypted per-seller credentials + the live token, injected per call. */
export interface CourierContext {
  /** e.g. { email, password } for Shiprocket. */
  credentials: Record<string, unknown>;
  /** Current valid bearer token (refreshed by CourierAccountService). */
  token: string | null;
  /** Default pickup-location nickname registered with the provider. */
  pickupLocationNickname?: string | null;
}

export interface CourierLoginResult {
  token: string;
  /** Absolute expiry; CourierAccountService persists it encrypted. */
  expiresAt: Date;
}

export interface RateRequest {
  pickupPincode: string;
  deliveryPincode: string;
  /** Billable (ceil) weight in kg. */
  weightKg: number;
  /** Seller-order merchandise subtotal, for insurance/declared value. */
  declaredValue: number;
  cod: boolean;
  dimensionsCm?: { length: number; breadth: number; height: number } | null;
}

export interface RateQuote {
  /** Provider's internal courier id (Shiprocket courier_company_id). */
  providerCourierId: string;
  courierName: string;
  /** ₹ — treated TAX-INCLUSIVE by the downstream GST back-calc. */
  rate: number;
  estimatedDays: number | null;
  codAvailable: boolean;
  recommended: boolean;
  serviceable: boolean;
}

export interface ShipmentAddress {
  name: string;
  lastName?: string | null;
  phone: string;
  email?: string | null;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  state: string;
  pincode: string;
  country: string;
}

export interface CreateShipmentRequest {
  /** Our SellerOrder.orderNumber → provider order_id. */
  orderNumber: string;
  orderDate: Date;
  pickupLocationNickname: string;
  billing: ShipmentAddress;
  shipping: ShipmentAddress;
  items: {
    name: string;
    sku: string;
    units: number;
    sellingPrice: number;
    hsn?: string | null;
    gstPercent?: number | null;
  }[];
  paymentMethod: 'COD' | 'Prepaid';
  subTotal: number;
  weightKg: number;
  dimensionsCm: { length: number; breadth: number; height: number };
  /** Snapshotted courier from the quote, so ship-time reuses the same one. */
  preferredCourierId?: string | null;
}

export interface ShipmentResult {
  providerOrderId: string;
  providerShipmentId: string;
}

/**
 * Reverse (return) pickup request (P3-02). The courier COLLECTS from the buyer
 * (`customer`) and delivers back to the seller (`seller`). `pickupLocationNickname`
 * is the seller's registered return/warehouse location.
 */
export interface CreateReturnShipmentRequest {
  /** Original forward SellerOrder.orderNumber (for provider correlation). */
  orderNumber: string;
  /** Our RMA number → the reverse shipment's provider order_id. */
  returnNumber: string;
  orderDate: Date;
  pickupLocationNickname: string;
  /** Where the courier collects the item — the buyer. */
  customer: ShipmentAddress;
  /** Where the item is returned to — the seller warehouse. */
  seller: ShipmentAddress;
  items: {
    name: string;
    sku: string;
    units: number;
    sellingPrice: number;
    hsn?: string | null;
  }[];
  subTotal: number;
  weightKg: number;
  dimensionsCm: { length: number; breadth: number; height: number };
}

export interface AwbResult {
  awbCode: string;
  courierName: string;
}

export interface PickupResult {
  scheduled: boolean;
  scheduledDate?: string | null;
}

export interface LabelResult {
  labelUrl: string;
}

export interface TrackingScan {
  time: string;
  location?: string | null;
  activity: string;
}

export interface TrackingUpdate {
  awbCode: string;
  providerStatusCode: string;
  providerStatus: string;
  scans: TrackingScan[];
  deliveredAt?: Date | null;
}

export interface PickupLocationInput {
  nickname: string;
  name: string;
  phone: string;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  state: string;
  pincode: string;
  country: string;
}

/** An existing pickup location fetched from the provider account. */
export interface PickupLocation {
  /** Provider's id (Shiprocket pickup id). */
  id: string;
  /** The nickname referenced when creating orders (Shiprocket `pickup_location`). */
  nickname: string;
  name: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  phone: string;
}

/** Provider-agnostic delivery lifecycle. */
export enum NormalizedStatus {
  PENDING = 'PENDING',
  PICKED_UP = 'PICKED_UP',
  IN_TRANSIT = 'IN_TRANSIT',
  OUT_FOR_DELIVERY = 'OUT_FOR_DELIVERY',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
  NDR = 'NDR',
  RTO = 'RTO',
  UNKNOWN = 'UNKNOWN',
}

export interface NormalizedWebhook {
  awbCode: string | null;
  providerOrderId: string | null;
  providerShipmentId: string | null;
  normalizedStatus: NormalizedStatus;
  rawStatusCode: string;
  /** A stable per-event key for idempotency (awb|code|scanTime). */
  dedupeKey: string;
  rawPayload: unknown;
}

export interface ICourierProvider {
  readonly key: 'SHIPROCKET' | 'MOCK';

  /** Mint a fresh auth token from credentials (no refresh endpoint). */
  login(credentials: Record<string, unknown>): Promise<CourierLoginResult>;
  /** Cheap credential check used by "test connection". */
  testConnection(ctx: CourierContext): Promise<{ ok: boolean; message?: string }>;

  getRates(ctx: CourierContext, req: RateRequest): Promise<RateQuote[]>;
  createShipment(ctx: CourierContext, req: CreateShipmentRequest): Promise<ShipmentResult>;
  /** Create a REVERSE (return) pickup shipment (P3-02). */
  createReturnShipment(
    ctx: CourierContext,
    req: CreateReturnShipmentRequest,
  ): Promise<ShipmentResult>;
  assignAwb(ctx: CourierContext, shipmentId: string, courierId?: string | null): Promise<AwbResult>;
  schedulePickup(ctx: CourierContext, shipmentId: string): Promise<PickupResult>;
  getLabel(ctx: CourierContext, shipmentId: string): Promise<LabelResult>;
  track(ctx: CourierContext, awbCode: string): Promise<TrackingUpdate>;
  cancel(ctx: CourierContext, args: { providerOrderId?: string; awbCode?: string }): Promise<void>;
  registerPickupLocation(
    ctx: CourierContext,
    location: PickupLocationInput,
  ): Promise<{ providerLocationId: string; nickname: string }>;
  /** List the seller's existing pickup locations from the provider account. */
  listPickupLocations(ctx: CourierContext): Promise<PickupLocation[]>;

  /** Stateless parse of an inbound webhook body (account resolved by caller). */
  normalizeWebhook(rawBody: unknown): NormalizedWebhook;
  /** Map a raw provider status code to the normalized enum. */
  normalizeStatus(rawCode: string): NormalizedStatus;
}

/**
 * How a normalized courier status maps onto our order state machine.
 *   - PICKED_UP / IN_TRANSIT → SHIPPED (if not already)
 *   - DELIVERED → DELIVERED
 *   - CANCELLED → CANCELLED (only valid from pre-shipped states)
 *   - NDR / RTO → NO status change (SHIPPED→CANCELLED is forbidden); recorded
 *     as a metadata flag + history note + alert email for human resolution.
 * Returns null when the event should NOT drive a status transition.
 */
export function normalizedToOrderStatus(s: NormalizedStatus): OrderStatus | null {
  switch (s) {
    case NormalizedStatus.PICKED_UP:
    case NormalizedStatus.IN_TRANSIT:
    case NormalizedStatus.OUT_FOR_DELIVERY:
      return OrderStatus.SHIPPED;
    case NormalizedStatus.DELIVERED:
      return OrderStatus.DELIVERED;
    case NormalizedStatus.CANCELLED:
      return OrderStatus.CANCELLED;
    default:
      return null; // PENDING / NDR / RTO / UNKNOWN → no transition
  }
}
