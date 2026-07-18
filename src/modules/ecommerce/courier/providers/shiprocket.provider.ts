/**
 * Shiprocket adapter (https://apidocs.shiprocket.in/). Stateless: receives a
 * valid token in the CourierContext (minted/refreshed by CourierAccountService).
 *
 * Endpoints (base https://apiv2.shiprocket.in/v1/external):
 *   POST /auth/login                       → token (10-day TTL, no refresh)
 *   GET  /courier/serviceability/          → courier rates
 *   POST /orders/create/adhoc              → { order_id, shipment_id }
 *   POST /courier/assign/awb               → { awb_code, courier_name }
 *   POST /courier/generate/pickup          → pickup scheduled
 *   POST /courier/generate/label           → { label_url }
 *   GET  /courier/track/awb/{awb}          → tracking + scans
 *   POST /orders/cancel                    → cancel
 *   POST /settings/company/addpickup       → register pickup location
 *
 * Response shapes vary slightly across Shiprocket plan versions; parsing here is
 * defensive. Verify against a live account when credentials are added.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AwbResult,
  CourierContext,
  CourierLoginResult,
  CreateShipmentRequest,
  ICourierProvider,
  LabelResult,
  NormalizedStatus,
  NormalizedWebhook,
  PickupLocation,
  PickupLocationInput,
  PickupResult,
  RateQuote,
  RateRequest,
  ShipmentResult,
  TrackingUpdate,
} from './courier-provider.interface';
import {
  SHIPROCKET_BASE_URL,
  SHIPROCKET_STATUS_MAP,
  TOKEN_TTL_MS,
} from '../courier.constants';
import {
  isTransientError,
  withResilience,
  withTimeout,
} from '@/common/http/with-resilience';

/** Read timeout budget — serviceability/track/login/label/listPickup. */
const SHIPROCKET_READ_TIMEOUT_MS = 15_000;
/**
 * Write timeout budget — createShipment/assignAwb/schedulePickup/cancel/
 * registerPickupLocation. Deliberately longer than reads and NEVER retried:
 * a timed-out write may have succeeded server-side, so a retry risks a
 * duplicate shipment/AWB/pickup.
 */
const SHIPROCKET_WRITE_TIMEOUT_MS = 20_000;

interface ShiprocketCourier {
  courier_company_id: number | string;
  courier_name: string;
  rate: number | string;
  estimated_delivery_days?: string | number;
  etd?: string;
  cod?: number;
  is_recommended?: number | boolean;
  blocked?: number;
}

@Injectable()
export class ShiprocketProvider implements ICourierProvider {
  readonly key = 'SHIPROCKET' as const;
  private readonly logger = new Logger(ShiprocketProvider.name);

  constructor(private readonly config: ConfigService) {}

  private get baseUrl(): string {
    return this.config.get<string>('SHIPROCKET_BASE_URL') ?? SHIPROCKET_BASE_URL;
  }

  // ---------------------------------------------------------------------------
  // HTTP helper
  // ---------------------------------------------------------------------------

  private async request<T = any>(
    path: string,
    opts: {
      method?: string;
      token?: string | null;
      body?: unknown;
      query?: Record<string, unknown>;
      /**
       * Resilience mode:
       *   - 'read'  → timeout + bounded jittered retry on 429/5xx/network faults
       *               (idempotent GET-style calls; safe to retry).
       *   - 'write' → timeout ONLY, never retried (a timed-out mutating call may
       *               have succeeded server-side).
       * Defaults to 'read'.
       */
      mode?: 'read' | 'write';
    } = {},
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

    const method = opts.method ?? 'GET';
    const mode = opts.mode ?? 'read';
    const label = `shiprocket ${method} ${path}`;

    // One HTTP round-trip, cancellable via the resilience-supplied AbortSignal.
    const doFetch = async (signal: AbortSignal): Promise<T> => {
      const res = await fetch(url.toString(), {
        method,
        headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal,
      });
      const text = await res.text();
      let json: any = {};
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = { raw: text };
      }
      if (!res.ok) {
        const msg = json?.message || json?.error || `Shiprocket ${path} failed (${res.status})`;
        const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
        // Attach the status so isTransientError retries 429/5xx but never 4xx.
        (err as any).status = res.status;
        throw err;
      }
      return json as T;
    };

    if (mode === 'write') {
      // Writes: bound the wall-clock only. NEVER retried.
      return withTimeout(doFetch, { timeoutMs: SHIPROCKET_WRITE_TIMEOUT_MS, label });
    }
    return withResilience(doFetch, {
      timeoutMs: SHIPROCKET_READ_TIMEOUT_MS,
      retries: 2,
      retryOn: isTransientError,
      label,
    });
  }

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------

  async login(credentials: Record<string, unknown>): Promise<CourierLoginResult> {
    const email = String(credentials.email ?? '');
    const password = String(credentials.password ?? '');
    if (!email || !password) {
      throw new Error('Shiprocket credentials require email and password.');
    }
    const data = await this.request<{ token?: string }>('/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    if (!data.token) throw new Error('Shiprocket login did not return a token.');
    return { token: data.token, expiresAt: new Date(Date.now() + TOKEN_TTL_MS) };
  }

  async testConnection(ctx: CourierContext): Promise<{ ok: boolean; message?: string }> {
    try {
      await this.login(ctx.credentials);
      return { ok: true, message: 'Shiprocket connected.' };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  // ---------------------------------------------------------------------------
  // Rates / serviceability
  // ---------------------------------------------------------------------------

  async getRates(ctx: CourierContext, req: RateRequest): Promise<RateQuote[]> {
    const data = await this.request<any>('/courier/serviceability/', {
      token: ctx.token,
      query: {
        pickup_postcode: req.pickupPincode,
        delivery_postcode: req.deliveryPincode,
        weight: req.weightKg,
        cod: req.cod ? 1 : 0,
        declared_value: req.declaredValue,
      },
    });
    const couriers: ShiprocketCourier[] =
      data?.data?.available_courier_companies ?? data?.available_courier_companies ?? [];
    return couriers
      .filter((c) => !c.blocked)
      .map((c) => ({
        providerCourierId: String(c.courier_company_id),
        courierName: c.courier_name,
        rate: Math.round(Number(c.rate) * 100) / 100,
        estimatedDays:
          c.estimated_delivery_days != null ? Number(c.estimated_delivery_days) || null : null,
        codAvailable: Number(c.cod) === 1,
        recommended: c.is_recommended === 1 || c.is_recommended === true,
        serviceable: true,
      }));
  }

  // ---------------------------------------------------------------------------
  // Shipment lifecycle
  // ---------------------------------------------------------------------------

  async createShipment(ctx: CourierContext, req: CreateShipmentRequest): Promise<ShipmentResult> {
    const pad = (n: number) => String(n).padStart(2, '0');
    const d = req.orderDate;
    const orderDate = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

    const body = {
      order_id: req.orderNumber,
      order_date: orderDate,
      pickup_location: req.pickupLocationNickname,
      billing_customer_name: req.billing.name,
      billing_last_name: req.billing.lastName ?? '',
      billing_address: req.billing.addressLine1,
      billing_address_2: req.billing.addressLine2 ?? '',
      billing_city: req.billing.city,
      billing_pincode: req.billing.pincode,
      billing_state: req.billing.state,
      billing_country: req.billing.country,
      billing_email: req.billing.email ?? '',
      billing_phone: req.billing.phone,
      shipping_is_billing: false,
      shipping_customer_name: req.shipping.name,
      shipping_last_name: req.shipping.lastName ?? '',
      shipping_address: req.shipping.addressLine1,
      shipping_address_2: req.shipping.addressLine2 ?? '',
      shipping_city: req.shipping.city,
      shipping_pincode: req.shipping.pincode,
      shipping_state: req.shipping.state,
      shipping_country: req.shipping.country,
      shipping_email: req.shipping.email ?? '',
      shipping_phone: req.shipping.phone,
      order_items: req.items.map((it) => ({
        name: it.name,
        sku: it.sku,
        units: it.units,
        selling_price: it.sellingPrice,
        hsn: it.hsn ?? '',
      })),
      payment_method: req.paymentMethod,
      sub_total: req.subTotal,
      length: req.dimensionsCm.length,
      breadth: req.dimensionsCm.breadth,
      height: req.dimensionsCm.height,
      weight: req.weightKg,
    };

    const data = await this.request<any>('/orders/create/adhoc', {
      method: 'POST',
      token: ctx.token,
      body,
      mode: 'write', // non-idempotent: a retry could create a duplicate shipment
    });
    const providerOrderId = data?.order_id ?? data?.data?.order_id;
    const providerShipmentId = data?.shipment_id ?? data?.data?.shipment_id;
    if (!providerShipmentId) {
      throw new Error(`Shiprocket order created but no shipment_id returned: ${JSON.stringify(data)}`);
    }
    return {
      providerOrderId: String(providerOrderId ?? req.orderNumber),
      providerShipmentId: String(providerShipmentId),
    };
  }

  async assignAwb(ctx: CourierContext, shipmentId: string, courierId?: string | null): Promise<AwbResult> {
    const data = await this.request<any>('/courier/assign/awb', {
      method: 'POST',
      token: ctx.token,
      body: { shipment_id: shipmentId, ...(courierId ? { courier_id: courierId } : {}) },
      mode: 'write', // non-idempotent: a retry could assign/charge a second AWB
    });
    const resp = data?.response?.data ?? data?.data ?? data;
    const awb = resp?.awb_code ?? resp?.awb;
    if (!awb) throw new Error(`Shiprocket AWB assignment returned no awb_code: ${JSON.stringify(data)}`);
    return { awbCode: String(awb), courierName: resp?.courier_name ?? 'Shiprocket' };
  }

  async schedulePickup(ctx: CourierContext, shipmentId: string): Promise<PickupResult> {
    const data = await this.request<any>('/courier/generate/pickup', {
      method: 'POST',
      token: ctx.token,
      body: { shipment_id: [shipmentId] },
      mode: 'write', // non-idempotent: a retry could schedule a duplicate pickup
    });
    return {
      scheduled: true,
      scheduledDate: data?.response?.pickup_scheduled_date ?? data?.pickup_scheduled_date ?? null,
    };
  }

  async getLabel(ctx: CourierContext, shipmentId: string): Promise<LabelResult> {
    const data = await this.request<any>('/courier/generate/label', {
      method: 'POST',
      token: ctx.token,
      body: { shipment_id: [shipmentId] },
    });
    const url = data?.label_url ?? data?.data?.label_url;
    if (!url) throw new Error('Shiprocket label generation returned no label_url.');
    return { labelUrl: String(url) };
  }

  async track(ctx: CourierContext, awbCode: string): Promise<TrackingUpdate> {
    const data = await this.request<any>(`/courier/track/awb/${encodeURIComponent(awbCode)}`, {
      token: ctx.token,
    });
    const td = data?.tracking_data ?? data?.data?.[0] ?? data;
    const statusCode = String(td?.shipment_status ?? td?.current_status_code ?? '');
    const scans = (td?.shipment_track_activities ?? td?.scans ?? []).map((s: any) => ({
      time: s.date ?? s.timestamp ?? '',
      location: s.location ?? null,
      activity: s.activity ?? s.status ?? '',
    }));
    return {
      awbCode,
      providerStatusCode: statusCode,
      providerStatus: td?.shipment_status_text ?? td?.current_status ?? '',
      scans,
      deliveredAt: this.normalizeStatus(statusCode) === NormalizedStatus.DELIVERED ? new Date() : null,
    };
  }

  async cancel(ctx: CourierContext, args: { providerOrderId?: string; awbCode?: string }): Promise<void> {
    if (args.providerOrderId) {
      await this.request('/orders/cancel', {
        method: 'POST',
        token: ctx.token,
        body: { ids: [args.providerOrderId] },
        mode: 'write', // mutating state change — never auto-retried
      });
    }
  }

  async listPickupLocations(ctx: CourierContext): Promise<PickupLocation[]> {
    const data = await this.request<any>('/settings/company/pickup', { token: ctx.token });
    // Response nests the array under data.shipping_address (current API) or
    // data.data / pickup_locations across versions — handle defensively.
    const rows: any[] =
      data?.data?.shipping_address ??
      data?.shipping_address ??
      data?.data?.pickup_locations ??
      data?.pickup_locations ??
      [];
    return rows.map((r) => ({
      id: String(r.id ?? r.pickup_location_id ?? r.pickup_code ?? ''),
      nickname: String(r.pickup_location ?? r.pickup_code ?? r.name ?? ''),
      name: String(r.name ?? r.pickup_location ?? ''),
      address: String(r.address ?? r.address_1 ?? ''),
      city: String(r.city ?? ''),
      state: String(r.state ?? ''),
      pincode: String(r.pin_code ?? r.pincode ?? ''),
      phone: String(r.phone ?? ''),
    }));
  }

  async registerPickupLocation(
    ctx: CourierContext,
    location: PickupLocationInput,
  ): Promise<{ providerLocationId: string; nickname: string }> {
    const data = await this.request<any>('/settings/company/addpickup', {
      method: 'POST',
      token: ctx.token,
      mode: 'write', // non-idempotent: a retry could register a duplicate location
      body: {
        pickup_location: location.nickname,
        name: location.name,
        email: '',
        phone: location.phone,
        address: location.addressLine1,
        address_2: location.addressLine2 ?? '',
        city: location.city,
        state: location.state,
        country: location.country,
        pin_code: location.pincode,
      },
    });
    const id = data?.address?.id ?? data?.pickup_id ?? data?.data?.id;
    return { providerLocationId: String(id ?? location.nickname), nickname: location.nickname };
  }

  normalizeWebhook(rawBody: unknown): NormalizedWebhook {
    const b = (rawBody ?? {}) as Record<string, any>;
    const code = String(b.current_status_code ?? b.shipment_status_code ?? b.status_code ?? '');
    const awb = b.awb ? String(b.awb) : null;
    const scanTime = b.current_timestamp ?? b.scans?.[0]?.timestamp ?? b.scans?.[0]?.date ?? '';
    return {
      awbCode: awb,
      providerOrderId: b.order_id != null ? String(b.order_id) : null,
      providerShipmentId: b.shipment_id != null ? String(b.shipment_id) : null,
      normalizedStatus: this.normalizeStatus(code),
      rawStatusCode: code,
      dedupeKey: `SHIPROCKET|${awb ?? b.shipment_id ?? 'x'}|${code}|${scanTime}`,
      rawPayload: rawBody,
    };
  }

  normalizeStatus(rawCode: string): NormalizedStatus {
    return SHIPROCKET_STATUS_MAP[rawCode] ?? NormalizedStatus.UNKNOWN;
  }
}
