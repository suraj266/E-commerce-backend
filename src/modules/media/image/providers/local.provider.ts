import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import {
  IImageProvider,
  PresignContext,
  PresignResult,
  UploadedMeta,
  VariantOpts,
} from './image-provider.interface';

/**
 * Local-disk provider. Files live under `LOCAL_UPLOAD_DIR` (mounted as a
 * Docker volume). Master files in `master/`, transformed variants cached
 * lazily under `cache/<id>/<width>.<format>`.
 *
 * "Presigned upload" for local maps to: a POST to our own /media/upload
 * endpoint with the externalId we hand out here, secured by the user's
 * normal JWT. The endpoint stores the file to `master/<externalId>.<ext>`.
 *
 * The provider exposes helpers (`writeMaster`, `readMaster`, `cachePath`)
 * used by ImageController + ImageService — those aren't part of the
 * IImageProvider contract since other providers don't have local files.
 */
@Injectable()
export class LocalProvider implements IImageProvider {
  readonly name = 'local';
  private readonly logger = new Logger(LocalProvider.name);

  private readonly uploadDir: string;
  private readonly publicBaseUrl: string;

  constructor(config: ConfigService) {
    this.uploadDir = config.get<string>('LOCAL_UPLOAD_DIR', '/app/uploads');
    this.publicBaseUrl = config.get<string>(
      'LOCAL_PUBLIC_BASE_URL',
      'http://localhost:7000',
    );
  }

  // -------------------------------------------------------------------------
  // IImageProvider contract
  // -------------------------------------------------------------------------

  async presignUpload(ctx: PresignContext): Promise<PresignResult> {
    // For local, "presigning" just means handing out a fresh externalId.
    // The frontend uploads via our own /media/upload endpoint protected by
    // the user's JWT. We embed the id in the URL so the controller knows
    // where to save the bytes.
    const externalId = randomUUID();
    const uploadUrl = `${this.publicBaseUrl}/media/upload?externalId=${externalId}&purpose=${ctx.purpose}`;
    return {
      uploadUrl,
      method: 'POST',
      fields: {},
      externalId,
      expiresIn: 60 * 15, // 15 min
    };
  }

  async confirmUpload(externalId: string): Promise<UploadedMeta> {
    // For local, the controller already wrote the file + recorded metadata
    // before calling confirmUpload. This method just resolves the canonical
    // serving URL. Real metadata (width/height/format) is captured by the
    // controller and persisted to the DB at upload time — ImageService
    // forwards that to the caller.
    return {
      externalId,
      url: this.canonicalUrl(externalId),
      format: 'unknown', // populated by controller before persisting
      width: 0,
      height: 0,
      sizeBytes: 0,
    };
  }

  variantUrl(externalId: string, opts: VariantOpts): string {
    const params = new URLSearchParams();
    if (opts.width) params.set('w', String(opts.width));
    if (opts.format && opts.format !== 'auto') params.set('format', opts.format);
    if (opts.quality) params.set('q', String(opts.quality));
    const qs = params.toString();
    return qs ? `${this.canonicalUrl(externalId)}?${qs}` : this.canonicalUrl(externalId);
  }

  async delete(externalId: string): Promise<void> {
    // Best-effort cleanup of master + variant cache. We don't fail the
    // whole flow if files are already gone.
    try {
      const master = await this.findMaster(externalId);
      if (master) await fs.unlink(master);
    } catch (err) {
      this.logger.warn(
        `Could not delete master for ${externalId}: ${(err as Error).message}`,
      );
    }
    try {
      await fs.rm(this.cacheDirFor(externalId), { recursive: true, force: true });
    } catch (err) {
      this.logger.warn(
        `Could not clear cache for ${externalId}: ${(err as Error).message}`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Local-only helpers (used by ImageController / ImageService)
  // -------------------------------------------------------------------------

  /** Returns the absolute path where the master file for `externalId` lives. */
  masterPath(externalId: string, format: string): string {
    return path.join(this.uploadDir, 'master', `${externalId}.${format}`);
  }

  cacheDirFor(externalId: string): string {
    return path.join(this.uploadDir, 'cache', externalId);
  }

  cachePath(externalId: string, width: number, format: string): string {
    return path.join(this.cacheDirFor(externalId), `${width}.${format}`);
  }

  /** Public URL clients render (master, no transforms). */
  canonicalUrl(externalId: string): string {
    return `${this.publicBaseUrl}/media/${externalId}`;
  }

  /** Locate the master file regardless of stored format extension. */
  async findMaster(externalId: string): Promise<string | null> {
    const dir = path.join(this.uploadDir, 'master');
    try {
      const entries = await fs.readdir(dir);
      const match = entries.find((f) => f.startsWith(`${externalId}.`));
      return match ? path.join(dir, match) : null;
    } catch {
      return null;
    }
  }

  /** Ensure the `master/` and `cache/` subdirectories exist. */
  async ensureDirs(): Promise<void> {
    await fs.mkdir(path.join(this.uploadDir, 'master'), { recursive: true });
    await fs.mkdir(path.join(this.uploadDir, 'cache'), { recursive: true });
  }
}
