/**
 * P3-04 — RedisReadinessIndicator: a Terminus-shaped readiness check for Redis.
 *
 * The outbox already ships a boot-time Redis probe (`RedisHealthIndicator` in
 * the outbox module, which aborts startup if Redis is unreachable) and exposes
 * `isHealthy()` for exactly this purpose. This is the thin Terminus adapter so
 * the check can be dropped into `HealthController`'s `check([...])` array
 * WITHOUT opening a second Redis connection — it delegates to the existing,
 * shared client.
 *
 * It returns a plain `HealthIndicatorResult` on success and throws on failure
 * (Terminus marks the aggregate check DOWN when an indicator throws) — so it
 * uses no deprecated Terminus runtime API.
 *
 * CENTRAL-WIRING: `HealthController` (not in this workstream's OWNS set) should
 * add `() => this.redisReadiness.isHealthy('redis')` to its `check([...])`.
 */

import {
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { HealthIndicatorResult } from '@nestjs/terminus';
import { RedisHealthIndicator } from '@/modules/outbox/redis.health';

@Injectable()
export class RedisReadinessIndicator {
  constructor(private readonly redis: RedisHealthIndicator) {}

  async isHealthy(key = 'redis'): Promise<HealthIndicatorResult> {
    const healthy = await this.redis.isHealthy();
    if (!healthy) {
      throw new ServiceUnavailableException(`${key} is not reachable`);
    }
    return { [key]: { status: 'up' } };
  }
}
