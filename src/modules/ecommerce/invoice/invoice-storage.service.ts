import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { promises as fs } from 'fs';
import { join } from 'path';
import { getCorrelationId } from '@/common/context/request-context';

/** Per-attempt socket timeouts so a hung S3 connection can't block forever. */
const S3_CONNECTION_TIMEOUT_MS = 5_000;
const S3_REQUEST_TIMEOUT_MS = 30_000;
/** Total attempts (initial + SDK's built-in retries) for transient S3 faults. */
const S3_MAX_ATTEMPTS = 3;

/**
 * Persists generated invoice PDFs to the configured backend.
 *
 * Mirrors `IMAGE_PROVIDER` env switching so dev defaults to local disk and
 * production hosts in S3. We deliberately do NOT reuse the IImageProvider
 * interface — its presign / variant abstractions don't fit a server-side
 * raw-buffer write.
 *
 * S3 layout:   `invoices/{sellerId}/{invoiceNumberSafe}.pdf`
 * Local layout: `uploads/invoices/{sellerId}/{invoiceNumberSafe}.pdf`
 *
 * The "safe" filename replaces every '/' in the invoice number with '_'
 * (the canonical `INV/FY26-27/...` form has slashes that aren't valid as
 * S3 object names without URL-encoding).
 */
@Injectable()
export class InvoiceStorageService {
  private readonly logger = new Logger(InvoiceStorageService.name);

  // Lazy S3 client — only initialised when first needed so local-only
  // deployments don't need AWS env vars.
  private _s3: { client: S3Client; bucket: string; publicBaseUrl: string } | null =
    null;

  constructor(private readonly config: ConfigService) {}

  private get providerKind(): 'local' | 's3' {
    const v = this.config.get<string>('IMAGE_PROVIDER', 'local');
    return v === 's3' ? 's3' : 'local';
  }

  private get s3() {
    if (!this._s3) {
      const bucket = this.config.getOrThrow<string>('AWS_S3_BUCKET');
      const region = this.config.getOrThrow<string>('AWS_REGION');
      this._s3 = {
        bucket,
        publicBaseUrl: this.config.get<string>(
          'AWS_S3_PUBLIC_BASE_URL',
          `https://${bucket}.s3.${region}.amazonaws.com`,
        ),
        client: new S3Client({
          region,
          credentials: {
            accessKeyId: this.config.getOrThrow<string>('AWS_ACCESS_KEY_ID'),
            secretAccessKey: this.config.getOrThrow<string>(
              'AWS_SECRET_ACCESS_KEY',
            ),
          },
          // Bound each attempt's socket + cap retries so a hung S3 connection
          // can't block invoice generation forever. PutObject is idempotent
          // (same key overwrites), so the SDK's transient retries are safe.
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
   * Upload a rendered PDF buffer and return its retrievable URL.
   *
   * The returned URL is what we persist on `SellerOrder.invoiceUrl` and
   * what the customer/seller "Download Invoice" buttons link to.
   */
  async putPdf(
    sellerId: string,
    invoiceNumber: string,
    pdf: Buffer,
  ): Promise<string> {
    const safeName = invoiceNumber.replace(/\//g, '_');
    if (this.providerKind === 's3') {
      return this.putS3(sellerId, safeName, pdf);
    }
    return this.putLocal(sellerId, safeName, pdf);
  }

  private async putS3(
    sellerId: string,
    safeName: string,
    pdf: Buffer,
  ): Promise<string> {
    const key = `invoices/${sellerId}/${safeName}.pdf`;
    try {
      await this.s3.client.send(
        new PutObjectCommand({
          Bucket: this.s3.bucket,
          Key: key,
          Body: pdf,
          ContentType: 'application/pdf',
          // Cache moderately — invoices are immutable once allocated, but
          // admin regenerate replaces the same key, so cap at 5 minutes.
          CacheControl: 'private, max-age=300',
        }),
      );
    } catch (err) {
      this.logger.error(
        `S3 upload failed for invoice ${safeName} (correlationId=${getCorrelationId() ?? '-'}): ${(err as Error).message}`,
      );
      throw new InternalServerErrorException(
        'Failed to upload invoice PDF to storage',
      );
    }
    return `${this.s3.publicBaseUrl}/${key}`;
  }

  private async putLocal(
    sellerId: string,
    safeName: string,
    pdf: Buffer,
  ): Promise<string> {
    // Use the same upload root + public base URL as the image module so the
    // bytes land where InvoiceController serves them and the URL points at
    // the backend origin (not the frontend, which would 404).
    const root = this.config.get<string>('LOCAL_UPLOAD_DIR', '/app/uploads');
    const dir = join(root, 'invoices', sellerId);
    await fs.mkdir(dir, { recursive: true });
    const filePath = join(dir, `${safeName}.pdf`);
    await fs.writeFile(filePath, pdf);
    // Return an ABSOLUTE URL (mirrors the image provider). The frontend
    // download link uses it verbatim, so it must resolve to the backend
    // origin where InvoiceController streams the file.
    const base = this.config.get<string>(
      'LOCAL_PUBLIC_BASE_URL',
      'http://localhost:7000',
    );
    return `${base}/invoices/${sellerId}/${safeName}.pdf`;
  }
}
