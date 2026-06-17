/**
 * EmailModule — admin-configurable SMTP + templated transactional email.
 *
 * Exports `EmailService` so other modules (auth, order, seller) can call
 * `email.send("password_reset", to, { ...vars })` directly. Soft-fails
 * gracefully when SMTP is not configured, so callers don't need to gate
 * their own logic on configuration state.
 */

import { Module } from '@nestjs/common';

import { CryptoService } from '@/common/crypto/crypto.service';
import { SiteSettingModule } from '@/modules/admin/site-setting/site-setting.module';

import { EmailConfigService } from './email-config.service';
import { EmailTemplateService } from './email-template.service';
import { EmailService } from './email.service';
import { EmailResolver } from './email.resolver';

@Module({
  imports: [SiteSettingModule],
  providers: [
    CryptoService,
    EmailConfigService,
    EmailTemplateService,
    EmailService,
    EmailResolver,
  ],
  exports: [EmailService, EmailConfigService, EmailTemplateService],
})
export class EmailModule {}
