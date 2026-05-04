import { Module } from '@nestjs/common';
import { TagService } from './tag.service';
import { TagResolver } from './tag.resolver';

@Module({
  providers: [TagService, TagResolver],
  exports: [TagService],
})
export class TagModule {}
