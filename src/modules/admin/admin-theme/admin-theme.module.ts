import { Module } from '@nestjs/common';
import { AdminThemeService } from './admin-theme.service';
import { AdminThemeResolver } from './admin-theme.resolver';

@Module({
  providers: [AdminThemeService, AdminThemeResolver],
  exports: [AdminThemeService],
})
export class AdminThemeModule {}
