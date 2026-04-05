import { TerminusModule } from "@nestjs/terminus";
import { PrismaModule } from "@/prisma/prisma.module";
import { HealthController } from "./health.controller";
import { Module } from "@nestjs/common";

@Module({
    imports: [TerminusModule, PrismaModule],
    controllers: [HealthController]
})
export class HealthModule { }