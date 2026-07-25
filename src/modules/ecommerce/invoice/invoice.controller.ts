import { Controller, Get, Param, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { createReadStream } from 'fs';
import { promises as fsp } from 'fs';
import { join, normalize } from 'path';

/**
 * Serves generated invoice PDFs from local disk.
 *
 * Mirrors the image module's `GET /media/:id` data-plane route: the control
 * plane (generation, regenerate) lives in the resolver; the binary stream
 * lives here. Only used for the local storage provider — when IMAGE_PROVIDER
 * is `s3`, InvoiceStorageService returns an absolute S3 URL and this route is
 * never hit.
 *
 * Route: `GET /invoices/:sellerId/:filename` — public (like /media). The PDF
 * contains buyer PII, so authenticated/authorized download is a recommended
 * hardening (see notes), but for parity with the existing public media route
 * this streams the file directly. Path-traversal is blocked by strict param
 * validation + a resolved-path containment check.
 */
@Controller('invoices')
export class InvoiceController {
  private readonly uploadDir: string;

  constructor(config: ConfigService) {
    this.uploadDir = config.get<string>('LOCAL_UPLOAD_DIR', '/app/uploads');
  }

  /** GET /invoices/:sellerId/:filename — stream a generated invoice PDF inline from disk (path-traversal guarded). Public. */
  @Get(':sellerId/:filename')
  async serve(
    @Param('sellerId') sellerId: string,
    @Param('filename') filename: string,
    @Res() res: Response,
  ): Promise<void> {
    // Strict validation — sellerId is a UUID, filename is a safe PDF name.
    const isUuid = /^[a-f0-9-]{36}$/i.test(sellerId);
    const isSafeName = /^[A-Za-z0-9._-]+\.pdf$/.test(filename);
    if (!isUuid || !isSafeName) {
      res.status(400).send('Bad request');
      return;
    }

    const baseDir = join(this.uploadDir, 'invoices');
    const filePath = normalize(join(baseDir, sellerId, filename));
    // Defence in depth: ensure the resolved path stays under invoices/.
    if (!filePath.startsWith(normalize(baseDir))) {
      res.status(400).send('Bad request');
      return;
    }

    try {
      await fsp.access(filePath);
    } catch {
      res.status(404).send('Invoice not found');
      return;
    }

    res.setHeader('Content-Type', 'application/pdf');
    // `inline` opens it in the browser's PDF viewer (new tab); the filename is
    // used if the user chooses "Save as".
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    // Override Helmet's CORP=same-origin so the file can also be embedded by
    // the frontend (different origin in dev).
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    createReadStream(filePath).pipe(res);
  }
}
