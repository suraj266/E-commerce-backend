import {
  Injectable,
  Logger,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { promises as fs } from 'fs';
import { join, normalize } from 'path';
import { getCorrelationId } from '@/common/context/request-context';
import { EXPORT_S3_PREFIX, EXPORT_URL_TTL_HOURS } from './privacy.constants';

/** Per-attempt socket timeouts so a hung S3 connection can't block forever. */
const S3_CONNECTION_TIMEOUT_MS = 5_000;
const S3_REQUEST_TIMEOUT_MS = 30_000;
const S3_MAX_ATTEMPTS = 3;

export interface StoredExport {
  /** Signed, time-limited URL the principal downloads the bundle from. */
  fileUrl: string;
  /** When `fileUrl` stops working. */
  expiresAt: Date;
}

/**
 * Stores a generated data-export bundle and returns a SIGNED, EXPIRING download
 * URL. Mirrors InvoiceStorageService's `IMAGE_PROVIDER` env switch (local disk
 * in dev, S3 in prod) but — unlike an invoice PDF, which is served from a stable
 * public URL — an export bundle is sensitive personal data, so:
 *
 *   - S3 path: the object is PRIVATE; we return a presigned GET URL that expires
 *     after EXPORT_URL_TTL_HOURS. No permanent public link ever exists.
 *   - Local path (dev only): we write under the uploads dir and return a plain
 *     URL. NOTE: a local URL is NOT cryptographically expiring — dev only.
 *
 * S3 layout:   `data-exports/{userId}/{exportRequestId}.json`
 */
@Injectable()
export class PrivacyExportStorageService {
  private readonly logger = new Logger(PrivacyExportStorageService.name);

  private _s3: { client: S3Client; bucket: string } | null = null;

  constructor(private readonly config: ConfigService) {}

  private get providerKind(): 'local' | 's3' {
    const v = this.config.get<string>('IMAGE_PROVIDER', 'local');
    return v === 's3' ? 's3' : 'local';
  }

  /**
   * True when bundles are stored on local disk (dev). In this mode the stored
   * `fileUrl` points at the authenticated download route (served by
   * PrivacyExportDownloadController) rather than a static path; in S3 mode a
   * self-expiring presigned URL is returned directly and no route is involved.
   */
  get isLocalProvider(): boolean {
    return this.providerKind === 'local';
  }

  /**
   * Resolve the on-disk path of a locally-stored export bundle, with a
   * path-traversal containment check. Both `userId` and `exportRequestId` come
   * from a DB-loaded DataExportRequest (never raw user input) so they are
   * trusted, but we still contain the resolved path under the exports root as
   * defence in depth. Throws NotFound if the file is absent (swept/never built).
   */
  async localBundlePath(
    userId: string,
    exportRequestId: string,
  ): Promise<string> {
    const root = this.config.get<string>('LOCAL_UPLOAD_DIR', '/app/uploads');
    const baseDir = normalize(join(root, EXPORT_S3_PREFIX));
    const filePath = normalize(join(baseDir, userId, `${exportRequestId}.json`));
    if (!filePath.startsWith(baseDir)) {
      throw new NotFoundException('Export bundle not found.');
    }
    try {
      await fs.access(filePath);
    } catch {
      throw new NotFoundException('Export bundle not found.');
    }
    return filePath;
  }

  private get s3() {
    if (!this._s3) {
      const bucket = this.config.getOrThrow<string>('AWS_S3_BUCKET');
      const region = this.config.getOrThrow<string>('AWS_REGION');
      this._s3 = {
        bucket,
        client: new S3Client({
          region,
          credentials: {
            accessKeyId: this.config.getOrThrow<string>('AWS_ACCESS_KEY_ID'),
            secretAccessKey: this.config.getOrThrow<string>(
              'AWS_SECRET_ACCESS_KEY',
            ),
          },
          maxAttempts: S3_MAX_ATTEMPTS,
          requestHandler: new NodeHttpHandler({
            connectionTimeout: S3_CONNECTION_TIMEOUT_MS,
            requestTimeout: S3_REQUEST_TIMEOUT_MS,
          }),
        }),
      };
    }
    return this._s3;
  }

  /**
   * Upload the JSON bundle and return a signed URL + its expiry. Throws on a
   * storage failure so the outbox retries the whole export job.
   */
  async putBundle(
    userId: string,
    exportRequestId: string,
    json: string,
  ): Promise<StoredExport> {
    const ttlSeconds = EXPORT_URL_TTL_HOURS * 3600;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    if (this.providerKind === 's3') {
      const key = `${EXPORT_S3_PREFIX}/${userId}/${exportRequestId}.json`;
      try {
        await this.s3.client.send(
          new PutObjectCommand({
            Bucket: this.s3.bucket,
            Key: key,
            Body: json,
            ContentType: 'application/json',
            // Private object — reachable ONLY via the presigned URL below.
            CacheControl: 'private, no-store',
          }),
        );
        const fileUrl = await getSignedUrl(
          this.s3.client,
          new GetObjectCommand({ Bucket: this.s3.bucket, Key: key }),
          { expiresIn: ttlSeconds },
        );
        return { fileUrl, expiresAt };
      } catch (err) {
        this.logger.error(
          `S3 export upload failed for request ${exportRequestId} (correlationId=${getCorrelationId() ?? '-'}): ${(err as Error).message}`,
        );
        throw new InternalServerErrorException(
          'Failed to store data export bundle',
        );
      }
    }

    // Local dev fallback — NOT a cryptographically expiring URL. The bundle is
    // sensitive PII, so we do NOT expose it at a static, guessable path (as the
    // old `/data-exports/{userId}/{id}.json` URL did — which additionally 404'd
    // because nothing served it). Instead we point at the authenticated
    // download route, which enforces principal-ownership + the READY/expiry
    // semantics before streaming the file (PrivacyExportDownloadController).
    const root = this.config.get<string>('LOCAL_UPLOAD_DIR', '/app/uploads');
    const dir = join(root, EXPORT_S3_PREFIX, userId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(join(dir, `${exportRequestId}.json`), json);
    const base = this.config.get<string>(
      'LOCAL_PUBLIC_BASE_URL',
      'http://localhost:7000',
    );
    return {
      fileUrl: `${base}/privacy/data-export/${exportRequestId}/download`,
      expiresAt,
    };
  }
}
