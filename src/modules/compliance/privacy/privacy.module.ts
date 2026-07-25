/**
 * PrivacyModule — DPDP Act 2023 data-subject rights (P3-07).
 *
 * Wiring notes:
 *   - EmailModule  → EmailService (the export-ready email).
 *   - AuthModule   → AuthService  (revoke sessions/tokens during erasure).
 *   - UserService is provided LOCALLY rather than imported: UserModule does not
 *     export it, and UserService depends only on the @Global PrismaService, so
 *     a local (stateless) instance is safe and keeps this module self-contained
 *     without editing the identity module's wiring.
 *   - PrismaService / OutboxService / ConfigService are all @Global.
 *
 * PrivacyService is exported so the central outbox EmailsProcessor can inject it
 * to run the `privacy.data_export` handler (see CENTRAL-WIRING TODO).
 *
 * NOTE: This module is registered in AppModule by the orchestrator.
 */

import { Module } from '@nestjs/common';
import { EmailModule } from '@/modules/admin/email/email.module';
import { AuthModule } from '@/modules/identity/auth/auth.module';
import { UserService } from '@/modules/identity/user/user.service';
import { PrivacyService } from './privacy.service';
import { PrivacyResolver } from './privacy.resolver';
import { PrivacyExportStorageService } from './privacy-export-storage.service';
import { PrivacyExportDownloadController } from './privacy-export-download.controller';
import { PrivacyErasureCron } from './privacy-erasure.cron';

@Module({
  imports: [EmailModule, AuthModule],
  controllers: [PrivacyExportDownloadController],
  providers: [
    PrivacyService,
    PrivacyResolver,
    PrivacyExportStorageService,
    PrivacyErasureCron,
    UserService,
  ],
  exports: [PrivacyService],
})
export class PrivacyModule {}
