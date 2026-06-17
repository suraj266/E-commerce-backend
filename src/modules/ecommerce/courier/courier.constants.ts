import { NormalizedStatus } from './providers/courier-provider.interface';

/** Shiprocket external API base (overridable via SHIPROCKET_BASE_URL). */
export const SHIPROCKET_BASE_URL = 'https://apiv2.shiprocket.in/v1/external';

/** Shiprocket tokens last ~10 days; refresh a bit early to avoid mid-call expiry. */
export const TOKEN_TTL_MS = 10 * 24 * 60 * 60 * 1000;
export const TOKEN_REFRESH_SKEW_MS = 6 * 60 * 60 * 1000; // refresh when <6h left

/** Live-rate call timeout — exceed it and we fall back to the in-house engine. */
export const DEFAULT_RATE_TIMEOUT_MS = 4000;
/** Rate cache TTL — keeps quote≈placement and caps Shiprocket calls. */
export const DEFAULT_RATE_CACHE_TTL_MS = 10 * 60 * 1000;

/** Fallback box when a seller-order has no usable variant/product dimensions. */
export const DEFAULT_BOX_CM = { length: 15, breadth: 15, height: 10 };

/**
 * Shiprocket shipment_status_code → normalized status.
 * 1 pending, 2 picked up, 3 in transit, 4 OFD, 5 cancelled, 6 delivered,
 * 7 NDR, 8 RTO (codes per Shiprocket tracking docs).
 */
export const SHIPROCKET_STATUS_MAP: Record<string, NormalizedStatus> = {
  '1': NormalizedStatus.PENDING,
  '2': NormalizedStatus.PICKED_UP,
  '3': NormalizedStatus.IN_TRANSIT,
  '4': NormalizedStatus.OUT_FOR_DELIVERY,
  '5': NormalizedStatus.CANCELLED,
  '6': NormalizedStatus.DELIVERED,
  '7': NormalizedStatus.NDR,
  '8': NormalizedStatus.RTO,
};
