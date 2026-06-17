import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DEFAULT_RATE_CACHE_TTL_MS } from './courier.constants';

interface Entry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Tiny in-memory TTL cache for live courier rates. Keeps the checkout quote ≈
 * the placement charge (same cached number within the TTL) and caps how often
 * we hit the provider. Single-instance; good enough for the catalog size.
 */
@Injectable()
export class CourierRateCacheService {
  private readonly store = new Map<string, Entry<unknown>>();

  constructor(private readonly config: ConfigService) {}

  private get ttl(): number {
    const raw = Number(this.config.get('COURIER_RATE_CACHE_TTL_MS'));
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RATE_CACHE_TTL_MS;
  }

  /** Weight is bucketed to 0.5kg slabs so near-identical carts share a key. */
  key(parts: {
    provider: string;
    pickupPincode: string;
    deliveryPincode: string;
    weightKg: number;
    cod: boolean;
  }): string {
    const slab = Math.ceil(parts.weightKg * 2) / 2;
    return `${parts.provider}|${parts.pickupPincode}|${parts.deliveryPincode}|${slab}|${parts.cod ? 1 : 0}`;
  }

  get<T>(key: string): T | null {
    const e = this.store.get(key);
    if (!e) return null;
    if (e.expiresAt < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return e.value as T;
  }

  set<T>(key: string, value: T): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttl });
  }
}
