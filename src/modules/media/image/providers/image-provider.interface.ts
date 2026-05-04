/**
 * Provider-agnostic contract for image storage backends. Each implementation
 * (local fs, S3, Cloudinary) must satisfy this interface so the rest of the
 * system can swap providers via env vars without code changes.
 */

import { ImagePurpose } from '@prisma/client';

export const IMAGE_PROVIDER = 'IMAGE_PROVIDER';

/** Caller-provided context when initiating an upload. */
export interface PresignContext {
  /** What the image is for — drives folder layout + presets. */
  purpose: ImagePurpose;
  /** Optional original filename (helps preserve extension). */
  originalName?: string;
  /** MIME-type the client claims. Server still validates via magic bytes. */
  contentType: string;
  /** Authenticated user id (for audit + folder layout). */
  userId: string;
}

/**
 * Returned by `presignUpload`. The frontend uses these to upload the file:
 *  - `local`: POST multipart to `uploadUrl` (handled by ImageController)
 *  - `s3`: PUT raw bytes to `uploadUrl` (presigned URL)
 *  - Cloudinary: signed POST to `uploadUrl` with `fields` extras
 */
export interface PresignResult {
  /** Where the frontend sends the bytes. */
  uploadUrl: string;
  /** HTTP method to use. */
  method: 'POST' | 'PUT';
  /** Extra form fields (Cloudinary signed upload, S3 POST policy). Empty for local/PUT. */
  fields: Record<string, string>;
  /** Provider-side identifier. The frontend sends this back via confirmUpload. */
  externalId: string;
  /** Upload window in seconds (presigned URLs expire). */
  expiresIn: number;
}

/**
 * Information we get back after the bytes have actually arrived. Some providers
 * tell us the dimensions for free (Cloudinary); others (S3, local) require us
 * to download/inspect the file ourselves via Sharp.
 */
export interface UploadedMeta {
  /** Stable provider identifier (used for variant URLs and deletes). */
  externalId: string;
  /** Canonical URL the client should render (master, no transforms). */
  url: string;
  /** jpeg / png / webp — detected via magic bytes, not extension. */
  format: string;
  width: number;
  height: number;
  sizeBytes: number;
}

/** Variant request for {@link IImageProvider.variantUrl}. */
export interface VariantOpts {
  /** Pixel width target. Provider may pick the closest pre-baked size. */
  width?: number;
  /** Output format. `auto` lets the provider pick based on Accept header. */
  format?: 'auto' | 'jpeg' | 'png' | 'webp' | 'avif';
  /** 1-100 quality. Most providers default to 75-80. */
  quality?: number;
}

export interface IImageProvider {
  /** Provider tag stored in the DB row (`local` / `s3` / `cloudinary`). */
  readonly name: string;

  /** Step 1 — issue upload credentials to the frontend. */
  presignUpload(ctx: PresignContext): Promise<PresignResult>;

  /**
   * Step 2 — called after the frontend reports a successful upload. The
   * provider must verify the bytes actually exist + return real dimensions.
   * For local provider this is a no-op (we already saved + measured the file
   * during the upload request).
   */
  confirmUpload(externalId: string): Promise<UploadedMeta>;

  /** Build a deterministic URL for a transformed variant of the master image. */
  variantUrl(externalId: string, opts: VariantOpts): string;

  /** Soft- or hard-delete the bytes for the given externalId. */
  delete(externalId: string): Promise<void>;
}
