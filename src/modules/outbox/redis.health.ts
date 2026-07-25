import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  Provider,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis, { Redis } from 'ioredis';
import { withTimeout } from '@/common/http/with-resilience';
import { REDIS_CLIENT } from './outbox.constants';

/**
 * Factory provider for the shared ioredis client.
 *
 * The SAME instance backs both the BullMQ connection (see OutboxModule) and the
 * boot health check, so we open one connection, not several. `maxRetriesPerRequest:
 * null` is REQUIRED by BullMQ (its blocking commands must never give up), and
 * ioredis parses the URL (including `rediss://` TLS) directly.
 */
export const redisClientProvider: Provider = {
  provide: REDIS_CLIENT,
  useFactory: (config: ConfigService): Redis => {
    const url = config.getOrThrow<string>('REDIS_URL');
    return new IORedis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: false,
    });
  },
  inject: [ConfigService],
};

/**
 * Fails app boot fast if Redis is unreachable.
 *
 * The whole Phase-3 reliability story rests on the outbox, which cannot drain
 * without Redis — so an unreachable Redis is a boot-blocking fault, not a
 * degrade. `OnApplicationBootstrap` PINGs with a hard timeout (commands would
 * otherwise queue indefinitely under `maxRetriesPerRequest: null`) and throws
 * to abort startup. `isHealthy()` is exposed for a future `/health` readiness
 * probe (P3-04).
 */
@Injectable()
export class RedisHealthIndicator
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(RedisHealthIndicator.name);
  private static readonly PING_TIMEOUT_MS = 5000;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const pong = await withTimeout(() => this.redis.ping(), {
        timeoutMs: RedisHealthIndicator.PING_TIMEOUT_MS,
        label: 'redis ping (boot)',
      });
      if (pong !== 'PONG') {
        throw new Error(`unexpected PING reply: ${pong}`);
      }
      this.logger.log('Redis connection verified — outbox queues are live.');
    } catch (err) {
      this.logger.error(
        `Redis is unreachable at boot: ${(err as Error).message}. ` +
          `Refusing to start — the durable outbox cannot drain without Redis.`,
      );
      throw err;
    }
  }

  /** Lightweight liveness check for a readiness probe. */
  async isHealthy(): Promise<boolean> {
    try {
      const pong = await withTimeout(() => this.redis.ping(), {
        timeoutMs: RedisHealthIndicator.PING_TIMEOUT_MS,
        label: 'redis ping',
      });
      return pong === 'PONG';
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }
}
