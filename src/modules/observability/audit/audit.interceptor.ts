/**
 * AuditInterceptor — records an audit row for any handler tagged with @Audit,
 * AFTER it resolves successfully. Best-effort: it delegates to
 * AuditService.record() (which never throws) and never alters the response.
 *
 * Registered globally as an APP_INTERCEPTOR in AppModule, but it is inert
 * unless a handler carries @Audit metadata, so it adds no cost to the vast
 * majority of requests. It works for both GraphQL and HTTP handlers.
 *
 * The money-movers (refund/payout/gateway-config) use explicit
 * AuditService.record() calls with precise before/after snapshots — this
 * interceptor covers the coarser long tail, capturing the (redacted) result as
 * the `after` snapshot.
 */

import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditService, redactSecrets } from './audit.service';
import { AUDIT_METADATA_KEY, AuditMetadata } from './audit.decorator';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.getAllAndOverride<AuditMetadata | undefined>(
      AUDIT_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!meta) return next.handle();

    const req = this.getRequest(context);
    const actorUserId: string | null = req?.user?.userId ?? null;
    const actorEmail: string | null = req?.user?.email ?? null;
    const ip = this.getIp(req);
    const userAgentRaw = req?.headers?.['user-agent'];
    const userAgent: string | null = Array.isArray(userAgentRaw)
      ? userAgentRaw[0]
      : (userAgentRaw ?? null);

    return next.handle().pipe(
      tap((result) => {
        // Fire-and-forget; record() swallows its own errors.
        void this.audit.record({
          action: meta.action,
          entityType: meta.entityType,
          entityId: this.extractEntityId(result),
          actorUserId,
          actorEmail,
          after: redactSecrets(result),
          ip,
          userAgent,
        });
      }),
    );
  }

  /** Pull the underlying request from a GraphQL or HTTP execution context. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getRequest(context: ExecutionContext): any {
    if (context.getType<string>() === 'graphql') {
      return GqlExecutionContext.create(context).getContext()?.req;
    }
    return context.switchToHttp().getRequest();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getIp(req: any): string | null {
    if (!req) return null;
    const fwd = req.headers?.['x-forwarded-for'];
    const fwdFirst = Array.isArray(fwd)
      ? fwd[0]
      : typeof fwd === 'string'
        ? fwd.split(',')[0]?.trim()
        : undefined;
    return req.ip ?? fwdFirst ?? req.socket?.remoteAddress ?? null;
  }

  /** Best-effort id extraction from a handler result for the entity anchor. */
  private extractEntityId(result: unknown): string | null {
    if (result && typeof result === 'object' && 'id' in result) {
      const id = (result as { id: unknown }).id;
      if (typeof id === 'string') return id;
    }
    return null;
  }
}
