import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { CollectionService } from './collection.service';
import { CollectionResolver } from './collection.resolver';

@Module({
  imports: [PrismaModule],
  providers: [CollectionService, CollectionResolver],
  exports: [CollectionService],
})
export class CollectionModule {}
