import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { getCorrelationId } from '@/common/context/request-context';
import {
  IImageProvider,
  PresignContext,
  PresignResult,
  UploadedMeta,
  VariantOpts,
} from './image-provider.interface';

/** Per-attempt socket timeouts so a hung S3 connection can't block forever. */
const S3_CONNECTION_TIMEOUT_MS = 5_000;
const S3_REQUEST_TIMEOUT_MS = 30_000;
/** Total attempts (initial + SDK's built-in retries) for transient S3 faults. */
const S3_MAX_ATTEMPTS = 3;

/**
 * AWS S3 provider using presigned PUT URLs. The frontend uploads bytes
 * directly to S3 (PUT); we never proxy the binary through Node.
 *
 * For variants, we return URLs that point at our /media/:id route too —
 * the controller falls back to fetching the master from S3, transforming
 * via Sharp, caching to local disk briefly, and serving. For production,
 * swap that path for CloudFront + Lambda@Edge or a dedicated transform
 * service. That swap doesn't change this provider's interface.
 */
@Injectable()
export class S3Provider implements IImageProvider {
  readonly name = 's3';
  private readonly logger = new Logger(S3Provider.name);

  // Lazily resolved on first use so the provider can be instantiated even
  // when AWS keys aren't set (e.g. dev runs with IMAGE_PROVIDER=local but
  // both providers are registered in the DI container).
  private _config: {
    bucket: string;
    region: string;
    publicBaseUrl: string;
    client: S3Client;
  } | null = null;

  constructor(private readonly config: ConfigService) {}

  private get conf() {
    if (!this._config) {
      const bucket = this.config.getOrThrow<string>('AWS_S3_BUCKET');
      const region = this.config.getOrThrow<string>('AWS_REGION');
      this._config = {
        bucket,
        region,
        publicBaseUrl: this.config.get<string>(
          'AWS_S3_PUBLIC_BASE_URL',
          `https://${bucket}.s3.${region}.amazonaws.com`,
        ),
        client: new S3Client({
          region,
          credentials: {
            accessKeyId: this.config.getOrThrow<string>('AWS_ACCESS_KEY_ID'),
            secretAccessKey: this.config.getOrThrow<string>('AWS_SECRET_ACCESS_KEY'),
          },
          // Bound each attempt's socket + cap retries so a hung S3 connection
          // can't block forever. The SDK retries transient (429/5xx/network)
          // faults with built-in backoff; PUT/GET/HEAD/DELETE are idempotent.
          maxAttempts: S3_MAX_ATTEMPTS,
          requestHandler: new NodeHttpHandler({
            connectionTimeout: S3_CONNECTION_TIMEOUT_MS,
            requestTimeout: S3_REQUEST_TIMEOUT_MS,
          }),
        }),
      };
    }
    return this._config;
  }

  private get bucket() { return this.conf.bucket; }
  private get publicBaseUrl() { return this.conf.publicBaseUrl; }
  private get client() { return this.conf.client; }

  async presignUpload(ctx: PresignContext): Promise<PresignResult> {
    const externalId = `${ctx.purpose.toLowerCase()}/${randomUUID()}`;
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: externalId,
      ContentType: ctx.contentType,
    });
    const uploadUrl = await getSignedUrl(this.client, command, {
      expiresIn: 60 * 15,
    });
    return {
      uploadUrl,
      method: 'PUT',
      fields: {},
      externalId,
      expiresIn: 60 * 15,
    };
  }

  async confirmUpload(externalId: string): Promise<UploadedMeta> {
    // Ensure the object actually exists; pull size from S3.
    let sizeBytes = 0;
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: externalId }),
      );
      sizeBytes = head.ContentLength ?? 0;
    } catch (err) {
      this.logger.warn(
        `HEAD failed for ${externalId} (correlationId=${getCorrelationId() ?? '-'}): ${(err as Error).message}`,
      );
      throw new NotFoundException('Upload not found in S3 — did the upload complete?');
    }

    // Width/height/format inspection happens in ImageService by streaming the
    // master through Sharp once. For S3 that's a small extra GET; we avoid
    // doing it here so this method stays cheap.
    return {
      externalId,
      url: `${this.publicBaseUrl}/${externalId}`,
      format: 'unknown',
      width: 0,
      height: 0,
      sizeBytes,
    };
  }

  variantUrl(externalId: string, opts: VariantOpts): string {
    // Variants are served by our /media route which fetches from S3 +
    // transforms. Future: replace with CloudFront-fronted Lambda@Edge.
    const id = encodeURIComponent(externalId);
    const params = new URLSearchParams();
    if (opts.width) params.set('w', String(opts.width));
    if (opts.format && opts.format !== 'auto') params.set('format', opts.format);
    if (opts.quality) params.set('q', String(opts.quality));
    const qs = params.toString();
    const path = `/media/${id}`;
    return qs ? `${path}?${qs}` : path;
  }

  async delete(externalId: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: externalId }),
      );
    } catch (err) {
      this.logger.warn(
        `S3 delete failed for ${externalId} (correlationId=${getCorrelationId() ?? '-'}): ${(err as Error).message}`,
      );
    }
  }

  /** Stream the master object out of S3 — used by ImageService.transformVariant. */
  async getMasterStream(externalId: string): Promise<Buffer> {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: externalId }),
    );
    if (!res.Body) {
      throw new NotFoundException(`Master not found in S3: ${externalId}`);
    }
    // Body is a Readable stream — collect into Buffer
    const chunks: Buffer[] = [];
    for await (const chunk of res.Body as unknown as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
}
