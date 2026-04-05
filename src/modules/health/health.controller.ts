import { Controller, Get } from "@nestjs/common";
import { HealthCheck, HealthCheckService } from "@nestjs/terminus";
import { PrismaService } from "src/prisma/prisma.service";

@Controller('health')
export class HealthController {
    constructor(
        private health: HealthCheckService,
        private prisma: PrismaService
    ) { }

    @Get()
    @HealthCheck()
    check() {
        return this.health.check([
            () => this.prisma.$queryRaw`SELECT 1`
        ])
    }
}