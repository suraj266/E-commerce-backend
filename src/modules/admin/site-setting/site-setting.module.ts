import { Module } from '@nestjs/common';
import { SiteSettingService } from './site-setting.service';
import { SiteSettingResolver } from './site-setting.resolver';

@Module({
  providers: [SiteSettingService, SiteSettingResolver],
  exports: [SiteSettingService],
})
export class SiteSettingModule {}
