import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '@/prisma/prisma.module';
import { SiteSettingModule } from '@/modules/admin/site-setting/site-setting.module';
import { InvoiceNumberService } from './invoice-number.service';
import { InvoiceStorageService } from './invoice-storage.service';
import { InvoiceTemplateService } from './invoice-template.service';
import { InvoiceService } from './invoice.service';
import { InvoiceResolver } from './invoice.resolver';
import { InvoiceController } from './invoice.controller';

@Module({
  imports: [ConfigModule, PrismaModule, SiteSettingModule],
  controllers: [InvoiceController],
  providers: [
    InvoiceNumberService,
    InvoiceStorageService,
    InvoiceTemplateService,
    InvoiceService,
    InvoiceResolver,
  ],
  exports: [InvoiceService],
})
export class InvoiceModule {}
