/**
 * ApiKeyService — mint / list / revoke / verify programmatic API keys.
 *
 * SECURITY CONTRACT
 * -----------------
 *  - The plaintext secret is generated here, returned to the caller ONCE by
 *    `create()`, and NEVER persisted. Only its SHA-256 hex (`keyHash`) and the
 *    public `keyPrefix` are stored.
 *  - `verify()` does a single-row lookup by the unique `keyPrefix`, rejects
 *    revoked/expired keys, then constant-time-compares SHA-256(presented)
 *    against the stored hash (timingSafeEqualStr) — no early-out on a mismatch.
 *  - `revoke()` is a winner-elect updateMany({ where:{ id, revokedAt:null }}),
 *    so a double-revoke is a no-op rather than a spurious success.
 *
 * The plaintext format is `sk_<16 hex>_<48 hex>`: the first two tokens
 * (`sk_<16 hex>`) are the stored `keyPrefix`; the trailing 24 bytes (192 bits)
 * are the secret. That high entropy is why a fast hash is safe (see the model
 * doc-comment).
 */

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { ApiKey } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { timingSafeEqualStr } from '@/common/crypto/timing-safe.util';
import { AuditService } from '@/modules/observability/audit/audit.service';

/** Human-recognisable label prefixing every key (`sk` = "secret key"). */
const KEY_LABEL = 'sk';
/** Bytes of randomness in the public prefix token (→ 16 hex chars). */
const PREFIX_BYTES = 8;
/** Bytes of randomness in the secret token (→ 48 hex chars, 192 bits). */
const SECRET_BYTES = 24;
/** Strict shape of a well-formed plaintext key; group 1 is the stored prefix. */
const KEY_RE = new RegExp(
  `^(${KEY_LABEL}_[0-9a-f]{${PREFIX_BYTES * 2}})_[0-9a-f]{${SECRET_BYTES * 2}}$`,
);

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export interface MintedApiKey {
  /** The full plaintext secret — returned once, never stored. */
  secret: string;
  apiKey: ApiKey;
}

export interface CreateApiKeyArgs {
  ownerUserId: string;
  name: string;
  scopes: string[];
  expiresAt?: Date | null;
  /** Acting user's email, for the audit trail (optional). */
  actorEmail?: string | null;
}

@Injectable()
export class ApiKeyService {
  private readonly logger = new Logger(ApiKeyService.name);

  constructor(
    private readonly prisma: PrismaService,
    // Optional trailing param so any positional unit test can construct this
    // service with just prisma; the running app always injects it (AuditModule
    // is @Global). Audit writes are best-effort. See P3-05.
    private readonly audit?: AuditService,
  ) {}

  /**
   * Mint a new key. Returns the plaintext secret EXACTLY ONCE; it is not stored
   * and cannot be recovered afterwards.
   */
  async create(args: CreateApiKeyArgs): Promise<MintedApiKey> {
    const keyPrefix = `${KEY_LABEL}_${randomBytes(PREFIX_BYTES).toString('hex')}`;
    const secret = `${keyPrefix}_${randomBytes(SECRET_BYTES).toString('hex')}`;
    const keyHash = sha256Hex(secret);

    const apiKey = await this.prisma.apiKey.create({
      data: {
        name: args.name,
        keyPrefix,
        keyHash,
        scopes: args.scopes,
        ownerUserId: args.ownerUserId,
        expiresAt: args.expiresAt ?? null,
      },
    });

    // Best-effort audit — record the metadata only, NEVER the secret/hash.
    await this.audit?.record({
      action: 'api_key.create',
      entityType: 'ApiKey',
      entityId: apiKey.id,
      actorUserId: args.ownerUserId,
      actorEmail: args.actorEmail ?? null,
      after: {
        id: apiKey.id,
        name: apiKey.name,
        keyPrefix: apiKey.keyPrefix,
        scopes: apiKey.scopes,
        expiresAt: apiKey.expiresAt,
      },
    });

    return { secret, apiKey };
  }

  /**
   * List keys (newest first), optionally scoped to one owner. Never returns the
   * hash to callers that shape the GraphQL entity (the entity omits it).
   */
  async list(ownerUserId?: string | null): Promise<ApiKey[]> {
    return this.prisma.apiKey.findMany({
      where: ownerUserId ? { ownerUserId } : {},
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Revoke a key. Winner-elect: only the first caller to flip a still-active row
   * succeeds; a revoke of an already-revoked (or missing) key raises NotFound so
   * the UI can report it truthfully rather than implying it just revoked it.
   */
  async revoke(id: string, actor?: { userId?: string; email?: string }): Promise<ApiKey> {
    const res = await this.prisma.apiKey.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (res.count === 0) {
      throw new NotFoundException('API key not found or already revoked.');
    }
    const apiKey = await this.prisma.apiKey.findUniqueOrThrow({ where: { id } });

    await this.audit?.record({
      action: 'api_key.revoke',
      entityType: 'ApiKey',
      entityId: apiKey.id,
      actorUserId: actor?.userId ?? apiKey.ownerUserId,
      actorEmail: actor?.email ?? null,
      after: { id: apiKey.id, keyPrefix: apiKey.keyPrefix, revokedAt: apiKey.revokedAt },
    });

    return apiKey;
  }

  /**
   * Authenticate a presented plaintext key. Returns the matching row (and bumps
   * `lastUsedAt`, best-effort) or `null` if the key is malformed, unknown,
   * revoked, expired, or the hash does not match. The compare is constant-time
   * and there is intentionally no distinct error for "wrong hash" vs "no such
   * key" — both return null.
   */
  async verify(presented: string | null | undefined): Promise<ApiKey | null> {
    const prefix = this.extractPrefix(presented);
    if (!prefix) return null;

    const apiKey = await this.prisma.apiKey.findUnique({
      where: { keyPrefix: prefix },
    });
    if (!apiKey) return null;
    if (apiKey.revokedAt) return null;
    if (apiKey.expiresAt && apiKey.expiresAt.getTime() <= Date.now()) return null;

    const computed = sha256Hex(presented as string);
    if (!timingSafeEqualStr(computed, apiKey.keyHash)) return null;

    // Best-effort last-used stamp; never fail auth on a bookkeeping write.
    try {
      await this.prisma.apiKey.update({
        where: { id: apiKey.id },
        data: { lastUsedAt: new Date() },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to update lastUsedAt for ApiKey ${apiKey.id}: ${(err as Error).message}`,
      );
    }

    return apiKey;
  }

  /** Extract the stored `keyPrefix` from a well-formed plaintext, else null. */
  private extractPrefix(presented: string | null | undefined): string | null {
    if (!presented) return null;
    const m = KEY_RE.exec(presented);
    return m ? m[1] : null;
  }
}
