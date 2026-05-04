import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { promises as fs } from 'fs';
import * as path from 'path';
import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import { ImageService } from './image.service';
import { LocalProvider } from './providers/local.provider';

const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * REST endpoints for the image module.
 *
 * - `POST /media/upload`  — local provider only. Receives multipart bytes
 *   from the frontend after presignUpload returned an externalId.
 *
 * - `GET /media/:externalId` — public. Serves the master OR a cached
 *   transformed variant. Width / format query params trigger Sharp; the
 *   result is cached on disk under `cache/<id>/<width>.<format>`.
 *
 * Why REST and not GraphQL: image bytes are binary streams. GraphQL is bad
 * at this. The control plane (presignUpload, confirmUpload, deleteImage)
 * lives in the resolver; the data plane lives here.
 */
@Controller('media')
export class ImageController {
  constructor(
    private readonly service: ImageService,
    private readonly local: LocalProvider,
  ) {}

  @Post('upload')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  async upload(
    @CurrentUser() user: CurrentUserPayload,
    @UploadedFile() file: Express.Multer.File,
    @Query('externalId') externalId: string,
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException('Missing file');
    if (!externalId) throw new BadRequestException('Missing externalId');
    if (file.size > MAX_BYTES) {
      throw new BadRequestException(`File too large (max ${MAX_BYTES} bytes)`);
    }

    // Magic-byte validation — never trust the client-claimed mimetype.
    const fileType = await import('file-type');
    const detected = await fileType.fileTypeFromBuffer(file.buffer);
    if (!detected || !ALLOWED_MIME.includes(detected.mime)) {
      throw new BadRequestException(
        `Unsupported file type. Allowed: ${ALLOWED_MIME.join(', ')}`,
      );
    }

    await this.local.ensureDirs();
    const masterPath = this.local.masterPath(externalId, detected.ext);
    await fs.writeFile(masterPath, file.buffer);

    // Acknowledge — frontend will follow up with confirmUpload mutation
    // to persist the DB row. We don't write to DB here so all "upload
    // happened, here's the metadata" logic stays in one place.
    return {
      externalId,
      uploadedBy: user.userId,
      sizeBytes: file.size,
      detectedMime: detected.mime,
      detectedExt: detected.ext,
      // Convenience for clients that don't separately call confirmUpload
      // (they'll just hit the /media/:id URL).
      url: this.local.canonicalUrl(externalId),
    };
  }

  /**
   * Serve the master image OR a transformed variant.
   *  /media/abc123                  → master
   *  /media/abc123?w=400            → 400-wide JPEG
   *  /media/abc123?w=400&format=webp → 400-wide WebP
   *
   * For S3 provider, this same controller still works — the service fetches
   * the master from S3, transforms via Sharp, caches locally for hot paths.
   * For Cloudinary, the canonical URL points directly at Cloudinary CDN
   * and this route isn't hit at all.
   */
  @Get(':externalId')
  async serve(
    @Param('externalId') externalId: string,
    @Query('w') wRaw: string,
    @Query('format') formatRaw: string,
    @Query('q') qRaw: string,
    @Res() res: Response,
  ) {
    const width = wRaw ? parseInt(wRaw, 10) : undefined;
    const quality = qRaw ? parseInt(qRaw, 10) : 80;
    const requested =
      (formatRaw as 'jpeg' | 'png' | 'webp' | 'avif' | 'auto' | undefined) ??
      'auto';

    // No transform requested → stream the master directly (cheap path).
    if (!width && (requested === 'auto' || !requested)) {
      if (this.service.activeProvider === 'local') {
        const masterPath = await this.local.findMaster(externalId);
        if (!masterPath) {
          res.status(404).send('Not found');
          return;
        }
        const ext = path.extname(masterPath).slice(1);
        res.setHeader('Content-Type', `image/${ext === 'jpg' ? 'jpeg' : ext}`);
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        // Override Helmet's default CORP=same-origin so the frontend (different
        // port in dev, possibly different subdomain in prod) can render this
        // image directly via <img src>.
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        const stream = await import('fs');
        stream.createReadStream(masterPath).pipe(res);
        return;
      }
      // For S3, the canonical URL already points at S3 — clients should hit
      // it directly. If they didn't, fall through to transform path.
    }

    const format = requested === 'auto' ? 'webp' : requested;

    // Disk cache check (local cache works for any provider).
    const cachePath = this.local.cachePath(
      externalId,
      width ?? 0,
      format,
    );
    try {
      const cached = await fs.readFile(cachePath);
      res.setHeader('Content-Type', `image/${format}`);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('X-Image-Cache', 'HIT');
      res.send(cached);
      return;
    } catch {
      // miss — transform now
    }

    try {
      const { buffer, contentType } = await this.service.transformMasterToBuffer(
        externalId,
        width,
        format as 'jpeg' | 'png' | 'webp' | 'avif',
        quality,
      );
      // Persist to disk cache (best-effort).
      try {
        await fs.mkdir(path.dirname(cachePath), { recursive: true });
        await fs.writeFile(cachePath, buffer);
      } catch {
        // cache write failed — still serve the bytes
      }
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('X-Image-Cache', 'MISS');
      res.send(buffer);
    } catch (err) {
      res.status(404).send((err as Error).message);
    }
  }
}
