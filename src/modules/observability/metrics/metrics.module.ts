/**
 * P3-04 — MetricsModule: Prometheus metrics + secured exposition.
 *
 * Wires:
 *   • `PrometheusModule` — default Node/process metrics + the metrics registry,
 *     with our SECURED `MetricsController` replacing the default open one.
 *   • `MetricsService`   — thin business-counter surface for domain code (the
 *     `record*` call sites are deferred this wave — see the WIRE-METRICS notes).
 *   • `OutboxMetricsCollector` — timer that refreshes the outbox backlog gauge.
 *   • `RedisReadinessIndicator` — Terminus adapter over the outbox's shared
 *     Redis client (imports OutboxModule for `RedisHealthIndicator`).
 *
 * The HTTP interceptor and the Prisma timing extension are NOT wired here: they
 * read shared singletons from `metrics.registry.ts` and are attached centrally
 * (APP_INTERCEPTOR in AppModule; the extension inside PrismaService) so they
 * work without cross-module metric injection.
 *
 * `@Global` so future domain increments can inject `MetricsService` without
 * importing this module (mirrors AuditModule).
 */

import { Global, Module } from '@nestjs/common';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { OutboxModule } from '@/modules/outbox/outbox.module';
import { MetricsController } from './metrics.controller';
import { MetricsAuthGuard } from './metrics-auth.guard';
import { MetricsService } from './metrics.service';
import { OutboxMetricsCollector } from './outbox-metrics.collector';
import { RedisReadinessIndicator } from './redis-readiness.health';

@Global()
@Module({
  imports: [
    // Registers default process/runtime metrics on the default registry and
    // mounts our secured controller in place of the library's open one. Leaving
    // @Controller()/@Get() bare in MetricsController lets `register` apply the
    // default `metrics` path → GET /metrics.
    PrometheusModule.register({
      controller: MetricsController,
      defaultMetrics: { enabled: true },
    }),
    // For RedisReadinessIndicator's delegate (RedisHealthIndicator is exported
    // by OutboxModule) — reuses the single shared ioredis connection.
    OutboxModule,
  ],
  providers: [
    MetricsAuthGuard,
    MetricsService,
    OutboxMetricsCollector,
    RedisReadinessIndicator,
  ],
  exports: [MetricsService, RedisReadinessIndicator],
})
export class MetricsModule {}
