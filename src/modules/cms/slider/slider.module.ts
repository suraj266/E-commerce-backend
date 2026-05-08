import { Module } from '@nestjs/common';
import { SliderService } from './slider.service';
import { SliderResolver } from './slider.resolver';

@Module({
  providers: [SliderService, SliderResolver],
  exports: [SliderService],
})
export class SliderModule {}
