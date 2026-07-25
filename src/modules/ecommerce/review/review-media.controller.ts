/**
 * Review media uploads — REST endpoints for image + short-clip attachments.
 *
 * Why a dedicated controller (instead of reusing /media/upload)?
 *   - /media/upload is image-only and tied to a presign + confirmUpload
 *     control plane meant for product images.
 *   - Review media has different constraints (smaller image cap, video
 *     allowed, no DB row at upload-time).
 *
 * Pipeline:
 *   1. Multer accepts the file with a 50MB hard cap (covers both images
 *      and short videos).
 *   2. Magic-byte detection rules out client-claimed-but-wrong types.
 *   3. Images: sharp pipeline → resize to 1080px long edge + webp/q80.
 *      Output is much smaller than the upload (good for serving + storage).
 *   4. Videos: stored as-is. v1 only validates size + type — no transcoding
 *      (ffmpeg is heavy). v2 should add a background job for poster frame +
 *      h264/aac normalisation.
 *   5. File written under `<LOCAL_UPLOAD_DIR>/review-media/<uuid>.<ext>`.
 *   6. Response: { url, type, sizeBytes, width?, height? }
 *
 * The Review create/update mutations later persist these URLs onto
 * ReviewMedia rows. The file itself isn't tied to a Review until then —
 * orphaned uploads can be GC'd by a periodic job (TODO).
 */

import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';
import type { Response } from 'express';
import { promises as fs, createReadStream } from 'fs';
import * as path from 'path';
import sharp from 'sharp';

import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '@/common/decorators/current-user.decorator';

const MAX_BYTES = 50 * 1024 * 1024; // 50MB hard cap (videos can hit this)
const ALLOWED_IMAGE = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_VIDEO = ['video/mp4'];

interface UploadResponse {
  url: string;
  type: 'IMAGE' | 'VIDEO';
  sizeBytes: number;
  width?: number;
  height?: number;
}

@Controller('media/review')
export class ReviewMediaController {
  private readonly logger = new Logger(ReviewMediaController.name);
  private readonly uploadDir: string;
  private readonly publicBaseUrl: string;

  constructor(config: ConfigService) {
    const base = config.get<string>('LOCAL_UPLOAD_DIR', '/app/uploads');
    this.uploadDir = path.join(base, 'review-media');
    this.publicBaseUrl = config.get<string>(
      'LOCAL_PUBLIC_BASE_URL',
      'http://localhost:7000',
    );
  }

  // ---------------------------------------------------------------------------
  // Upload
  // ---------------------------------------------------------------------------

  /** POST /media/review/upload — upload a review image/video (magic-byte checked; images re-encoded to 1080px webp). Auth: logged-in user. */
  @Post('upload')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }),
  )
  async upload(
    @CurrentUser() user: CurrentUserPayload,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<UploadResponse> {
    if (!file) throw new BadRequestException('Missing file');
    if (file.size > MAX_BYTES) {
      throw new BadRequestException(
        `File too large (max ${MAX_BYTES} bytes).`,
      );
    }

    // Magic-byte detection — never trust the client mimetype.
    const fileType = await import('file-type');
    const detected = await fileType.fileTypeFromBuffer(file.buffer);
    if (!detected) {
      throw new BadRequestException('Could not detect file type.');
    }

    await fs.mkdir(this.uploadDir, { recursive: true });
    const id = randomUUID();

    if (ALLOWED_IMAGE.includes(detected.mime)) {
      // Per-image cap is tighter than the global multer cap.
      const IMAGE_MAX = 5 * 1024 * 1024;
      if (file.size > IMAGE_MAX) {
        throw new BadRequestException(
          `Images must be 5MB or smaller (you uploaded ${(file.size / 1024 / 1024).toFixed(1)}MB).`,
        );
      }

      // Compress: max 1080px long edge, webp/quality 80. Customer-uploaded
      // photos are often huge; this keeps storage + serve cheap.
      const pipeline = sharp(file.buffer)
        .rotate() // honour EXIF orientation before strip
        .resize({
          width: 1080,
          height: 1080,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 80 });
      const compressed = await pipeline.toBuffer({ resolveWithObject: true });

      const fname = `${id}.webp`;
      await fs.writeFile(path.join(this.uploadDir, fname), compressed.data);
      this.logger.log(
        `Image saved: review-media/${fname} from=${user.userId} ` +
          `original=${file.size}B → compressed=${compressed.data.length}B (${compressed.info.width}x${compressed.info.height})`,
      );
      return {
        url: `${this.publicBaseUrl}/media/review/${fname}`,
        type: 'IMAGE',
        sizeBytes: compressed.data.length,
        width: compressed.info.width,
        height: compressed.info.height,
      };
    }

    if (ALLOWED_VIDEO.includes(detected.mime)) {
      // v1: no transcoding. Cap at the multer max already enforced.
      const fname = `${id}.${detected.ext}`;
      await fs.writeFile(path.join(this.uploadDir, fname), file.buffer);
      this.logger.log(
        `Video saved: review-media/${fname} from=${user.userId} size=${file.size}B`,
      );
      return {
        url: `${this.publicBaseUrl}/media/review/${fname}`,
        type: 'VIDEO',
        sizeBytes: file.size,
      };
    }

    throw new BadRequestException(
      `Unsupported file type. Allowed: ${[...ALLOWED_IMAGE, ...ALLOWED_VIDEO].join(', ')}.`,
    );
  }

  // ---------------------------------------------------------------------------
  // Serve
  // ---------------------------------------------------------------------------

  /**
   * Public — anyone with the URL can fetch. Returns the file from disk;
   * S3 provider would short-circuit by returning the S3 URL directly from
   * upload, never hitting this route.
   *
   * The `filename` segment includes the extension because the same dir
   * holds both .webp and .mp4 — we want to serve with the right
   * Content-Type without an extra lookup.
   */
  @Get(':filename')
  async serve(@Param('filename') filename: string, @Res() res: Response) {
    // Reject path traversal: filename must be exactly <uuid>.<ext> with no
    // slashes or `..`.
    if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
      res.status(400).send('Bad filename');
      return;
    }
    const full = path.join(this.uploadDir, filename);
    try {
      const ext = path.extname(filename).slice(1).toLowerCase();
      const contentType =
        ext === 'webp' ? 'image/webp' :
        ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
        ext === 'png' ? 'image/png' :
        ext === 'mp4' ? 'video/mp4' :
        'application/octet-stream';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      // Accept-Ranges for video seek support on partial requests
      if (contentType.startsWith('video/')) {
        res.setHeader('Accept-Ranges', 'bytes');
      }
      createReadStream(full).pipe(res);
    } catch (err) {
      this.logger.warn(
        `Failed to serve review-media/${filename}: ${(err as Error).message}`,
      );
      res.status(404).send('Not found');
    }
  }
}
