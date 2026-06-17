import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { LabelService } from './label.service';
import { LabelResolver } from './label.resolver';
import { ProductLabelsResolver } from './product-labels.resolver';

@Module({
  imports: [PrismaModule],
  providers: [LabelService, LabelResolver, ProductLabelsResolver],
  exports: [LabelService],
})
export class LabelModule {}
