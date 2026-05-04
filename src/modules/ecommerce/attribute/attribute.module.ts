import { Module } from '@nestjs/common';
import { AttributeService } from './attribute.service';
import { AttributeResolver } from './attribute.resolver';

@Module({
  providers: [AttributeService, AttributeResolver],
  exports: [AttributeService],
})
export class AttributeModule {}
