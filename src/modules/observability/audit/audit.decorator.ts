/**
 * @Audit(action, entityType) — declarative audit metadata for the "long tail"
 * of sensitive resolver/controller handlers that don't warrant a hand-written
 * AuditService.record() call. AuditInterceptor reads this metadata and records
 * an audit row after the handler resolves (best-effort).
 *
 * Use explicit AuditService.record() for the money-movers (refund/payout/
 * gateway-config) where you need precise before/after snapshots; reserve this
 * decorator for coarser "who did X" trails.
 */

import { SetMetadata } from '@nestjs/common';

export const AUDIT_METADATA_KEY = 'audit:metadata';

export interface AuditMetadata {
  action: string;
  entityType: string;
}

export const Audit = (action: string, entityType: string) =>
  SetMetadata(AUDIT_METADATA_KEY, { action, entityType });
