import { Controller, Get } from "@nestjs/common";
import { HealthCheck, HealthCheckService } from "@nestjs/terminus";
import { PrismaService } from "src/prisma/prisma.service";
import { RedisReadinessIndicator } from "@/modules/observability/metrics/redis-readiness.health";

@Controller('health')
export class HealthController {
    constructor(
        private health: HealthCheckService,
        private prisma: PrismaService,
        // P3-04: readiness fails if Redis (BullMQ/outbox transport) is down —
        // RedisReadinessIndicator is exported from the @Global MetricsModule.
        private redisReadiness: RedisReadinessIndicator,
    ) { }

    /** GET /health — liveness/readiness probe checking Postgres + Redis. Public. */
    @Get()
    @HealthCheck()
    check() {
        return this.health.check([
            () => this.prisma.$queryRaw`SELECT 1`,
            () => this.redisReadiness.isHealthy('redis'),
        ])
    }
}