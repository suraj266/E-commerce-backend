/**
 * Deterministic stub courier. Lets the whole quote → place → ship → webhook →
 * cron flow be exercised end-to-end with NO real credentials. Selected when a
 * CourierAccount.provider === 'MOCK' (gate with COURIER_ALLOW_MOCK in prod).
 *
 * Determinism matters: getRates must return the same number for the same
 * inputs so the checkout quote equals the placement charge.
 */

import { Injectable } from '@nestjs/common';
import {
  AwbResult,
  CourierContext,
  CourierLoginResult,
  CreateReturnShipmentRequest,
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
import { TOKEN_TTL_MS } from '../courier.constants';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

@Injectable()
export class MockProvider implements ICourierProvider {
  readonly key = 'MOCK' as const;

  async login(): Promise<CourierLoginResult> {
    return { token: 'mock-token', expiresAt: new Date(Date.now() + TOKEN_TTL_MS) };
  }

  async testConnection(): Promise<{ ok: boolean; message?: string }> {
    return { ok: true, message: 'Mock courier connected.' };
  }

  async getRates(_ctx: CourierContext, req: RateRequest): Promise<RateQuote[]> {
    // Deterministic: ₹40 base + ₹20/kg. Two couriers, cheapest recommended.
    const base = round2(40 + 20 * req.weightKg);
    return [
      {
        providerCourierId: 'MOCK-1',
        courierName: 'MockExpress',
        rate: base,
        estimatedDays: 3,
        codAvailable: true,
        recommended: true,
        serviceable: true,
      },
      {
        providerCourierId: 'MOCK-2',
        courierName: 'MockPostPremium',
        rate: round2(base + 30),
        estimatedDays: 2,
        codAvailable: req.cod,
        recommended: false,
        serviceable: true,
      },
    ];
  }

  async createShipment(_ctx: CourierContext, req: CreateShipmentRequest): Promise<ShipmentResult> {
    return {
      providerOrderId: `MOCK-ORD-${req.orderNumber}`,
      providerShipmentId: `MOCK-SHP-${req.orderNumber}`,
    };
  }

  async createReturnShipment(
    _ctx: CourierContext,
    req: CreateReturnShipmentRequest,
  ): Promise<ShipmentResult> {
    return {
      providerOrderId: `MOCK-RET-${req.returnNumber}`,
      providerShipmentId: `MOCK-RSHP-${req.returnNumber}`,
    };
  }

  async assignAwb(_ctx: CourierContext, shipmentId: string, courierId?: string | null): Promise<AwbResult> {
    return {
      awbCode: `MOCKAWB${shipmentId.replace(/[^A-Za-z0-9]/g, '')}`,
      courierName: courierId === 'MOCK-2' ? 'MockPostPremium' : 'MockExpress',
    };
  }

  async schedulePickup(): Promise<PickupResult> {
    return { scheduled: true, scheduledDate: null };
  }

  async getLabel(_ctx: CourierContext, shipmentId: string): Promise<LabelResult> {
    return { labelUrl: `https://example.test/mock-label/${shipmentId}.pdf` };
  }

  async track(_ctx: CourierContext, awbCode: string): Promise<TrackingUpdate> {
    return {
      awbCode,
      providerStatusCode: '6',
      providerStatus: 'Delivered',
      scans: [{ time: new Date().toISOString(), location: 'Mock Hub', activity: 'Delivered' }],
      deliveredAt: new Date(),
    };
  }

  async cancel(): Promise<void> {
    return;
  }

  async registerPickupLocation(
    _ctx: CourierContext,
    location: PickupLocationInput,
  ): Promise<{ providerLocationId: string; nickname: string }> {
    return { providerLocationId: `MOCK-LOC-${location.nickname}`, nickname: location.nickname };
  }

  async listPickupLocations(): Promise<PickupLocation[]> {
    return [
      {
        id: 'MOCK-LOC-1',
        nickname: 'Primary',
        name: 'Mock Primary Warehouse',
        address: '1 Mock Street',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400001',
        phone: '9876500000',
      },
      {
        id: 'MOCK-LOC-2',
        nickname: 'Secondary',
        name: 'Mock Secondary Hub',
        address: '2 Mock Road',
        city: 'Pune',
        state: 'Maharashtra',
        pincode: '411001',
        phone: '9876500001',
      },
    ];
  }

  normalizeWebhook(rawBody: unknown): NormalizedWebhook {
    const b = (rawBody ?? {}) as Record<string, any>;
    const code = String(b.current_status_code ?? b.shipment_status_code ?? '');
    const awb = b.awb ? String(b.awb) : null;
    const scanTime = b.current_timestamp ?? b.scans?.[0]?.timestamp ?? '';
    return {
      awbCode: awb,
      providerOrderId: b.order_id != null ? String(b.order_id) : null,
      providerShipmentId: b.shipment_id != null ? String(b.shipment_id) : null,
      normalizedStatus: this.normalizeStatus(code),
      rawStatusCode: code,
      dedupeKey: `MOCK|${awb ?? b.shipment_id ?? 'x'}|${code}|${scanTime}`,
      rawPayload: rawBody,
    };
  }

  normalizeStatus(rawCode: string): NormalizedStatus {
    const map: Record<string, NormalizedStatus> = {
      '1': NormalizedStatus.PENDING,
      '2': NormalizedStatus.PICKED_UP,
      '3': NormalizedStatus.IN_TRANSIT,
      '4': NormalizedStatus.OUT_FOR_DELIVERY,
      '5': NormalizedStatus.CANCELLED,
      '6': NormalizedStatus.DELIVERED,
      '7': NormalizedStatus.NDR,
      '8': NormalizedStatus.RTO,
    };
    return map[rawCode] ?? NormalizedStatus.UNKNOWN;
  }
}
