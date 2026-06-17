import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { SalesStatsService } from './sales-stats.service';

/**
 * Catalog stats — sales-velocity computation that powers data-driven
 * auto-labels (Bestseller/Trending) and smart-collection rules.
 *
 * Relies on ScheduleModule.forRoot() being registered once in AppModule.
 */
@Module({
  imports: [PrismaModule],
  providers: [SalesStatsService],
  exports: [SalesStatsService],
})
export class CatalogStatsModule {}
