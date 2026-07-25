import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { createReadStream } from 'fs';
import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '@/common/decorators/current-user.decorator';
import { PrivacyService } from './privacy.service';
import { PrivacyExportStorageService } from './privacy-export-storage.service';

/**
 * Authenticated download route for LOCALLY-stored DPDP data-export bundles.
 *
 * Why this exists: in dev (`IMAGE_PROVIDER != s3`) an export bundle is written
 * to local disk and PrivacyExportStorageService returns a `fileUrl` pointing
 * here. The bundle is a full copy of the principal's personal data, so — unlike
 * a public invoice PDF — it is NOT served from a static, guessable path. This
 * route re-checks, on every request:
 *   1. the caller is authenticated (JwtAuthGuard),
 *   2. the export belongs to THAT principal (ownership),
 *   3. the export is READY and not past its expiry
 *      (PrivacyService.authorizeExportDownload),
 * and only then streams the JSON. In S3 mode the stored `fileUrl` is a
 * self-expiring presigned URL and this route is never referenced (guarded to
 * 404 if hit anyway) — the module stays self-contained either way.
 *
 * Route: `GET /privacy/data-export/:id/download`.
 */
@Controller('privacy')
@UseGuards(JwtAuthGuard)
export class PrivacyExportDownloadController {
  constructor(
    private readonly privacy: PrivacyService,
    private readonly storage: PrivacyExportStorageService,
  ) {}

  /** GET /privacy/data-export/:id/download — stream the caller's DPDP export bundle (ownership + READY/expiry re-checked per request). Auth: logged-in user. */
  @Get('data-export/:id/download')
  async download(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') exportRequestId: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!user) throw new UnauthorizedException();

    // Only the local provider serves bundles from disk; in S3 mode the stored
    // URL is presigned and this route is not part of the flow.
    if (!this.storage.isLocalProvider) {
      throw new NotFoundException('Export not found.');
    }

    // Fail-closed auth + expiry gate (throws 404/410 otherwise).
    const request = await this.privacy.authorizeExportDownload(
      user.userId,
      exportRequestId,
    );

    // Locate the on-disk bundle using the DB-trusted userId/id (path-traversal
    // contained inside the storage service). Throws 404 if the file is gone.
    const filePath = await this.storage.localBundlePath(
      request.userId,
      request.id,
    );

    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="data-export-${request.id}.json"`,
    );
    // Sensitive PII — never cache the response.
    res.setHeader('Cache-Control', 'private, no-store');
    createReadStream(filePath).pipe(res);
  }
}
