/**
 * P3-04 — MetricsAuthGuard: secures GET /metrics.
 *
 *   • METRICS_ENABLED = false  → 404 (endpoint behaves as if it doesn't exist,
 *     leaking nothing about the metrics surface).
 *   • METRICS_AUTH_TOKEN set    → require `Authorization: Bearer <token>`, using
 *     a constant-time comparison so the token can't be recovered by timing.
 *   • METRICS_AUTH_TOKEN unset   → allow (private-network / ingress-ACL scrape,
 *     the default local-dev posture). See ops/README.md.
 *
 * Reads `config` (evaluated once at import from validated env) directly, so the
 * guard has zero injected dependencies and Nest can instantiate it standalone.
 */

import { timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { config } from '@/common/config/config';

/** Length-safe, constant-time string comparison. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

@Injectable()
export class MetricsAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (!config.METRICS_ENABLED) {
      throw new NotFoundException();
    }

    const token = config.METRICS_AUTH_TOKEN;
    if (!token) return true; // Open scrape (private network) — no token set.

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const req: any = context.switchToHttp().getRequest();
    const header = req?.headers?.['authorization'];
    const raw = Array.isArray(header) ? header[0] : header;
    const provided =
      typeof raw === 'string' && raw.startsWith('Bearer ')
        ? raw.slice('Bearer '.length).trim()
        : undefined;

    if (!provided || !safeEqual(provided, token)) {
      throw new UnauthorizedException('Invalid metrics token');
    }
    return true;
  }
}
