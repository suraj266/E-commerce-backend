/**
 * P3-04 — HttpMetricsInterceptor: observes `http_request_duration_seconds`
 * exactly ONCE per HTTP request, labelled by method / route / status_code.
 *
 * Registered globally as an APP_INTERCEPTOR in AppModule (alongside the existing
 * AuditInterceptor). Two subtleties this handles:
 *
 *   1. GraphQL fan-out. An APP_INTERCEPTOR fires once PER Nest-resolved
 *      field/resolver, so a single GraphQL HTTP request can trip it many times.
 *      We dedupe on the underlying `req` object (a per-request Symbol flag) and
 *      only arm the timer on the first sighting — one observation per HTTP
 *      request, not per resolver.
 *
 *   2. Timing boundary. We don't rely on the observable completing (which for
 *      GraphQL is per-resolver); instead we hook the HTTP response's `finish`
 *      event, so the duration spans until the full response is flushed and the
 *      status code is final.
 *
 * Route cardinality is bounded on purpose: GraphQL collapses to `graphql`, and
 * unmatched REST paths (404 scanners, random URLs) collapse to `(unmatched)`
 * rather than exploding the label set with attacker-controlled paths.
 */

import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { Observable } from 'rxjs';
import { httpRequestDuration } from './metrics.registry';

/** Per-request marker so the histogram is observed once, not per resolver. */
const METRICS_ARMED = Symbol('httpMetricsArmed');

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const isGraphql = context.getType<string>() === 'graphql';
    const { req, res } = this.getHttp(context, isGraphql);

    // Arm once per HTTP request. Missing req/res (non-HTTP transport) ⇒ skip.
    if (
      req &&
      res &&
      typeof res.on === 'function' &&
      !(req as Record<symbol, unknown>)[METRICS_ARMED]
    ) {
      (req as Record<symbol, unknown>)[METRICS_ARMED] = true;
      const stopTimer = httpRequestDuration.startTimer();
      res.on('finish', () => {
        stopTimer({
          method: String(req.method ?? 'UNKNOWN'),
          route: isGraphql ? 'graphql' : this.routeOf(req),
          status_code: String(res.statusCode ?? 0),
        });
      });
    }

    return next.handle();
  }

  /** Pull the raw HTTP req/res from a GraphQL or plain-HTTP execution context. */
  private getHttp(
    context: ExecutionContext,
    isGraphql: boolean,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): { req: any; res: any } {
    if (isGraphql) {
      const gqlCtx = GqlExecutionContext.create(context).getContext();
      return { req: gqlCtx?.req, res: gqlCtx?.res ?? gqlCtx?.req?.res };
    }
    const http = context.switchToHttp();
    return { req: http.getRequest(), res: http.getResponse() };
  }

  /**
   * Low-cardinality route label. Prefers the matched Express route PATTERN
   * (`/users/:id`, not `/users/abc123`); collapses unmatched paths so random
   * URLs cannot balloon the label set.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private routeOf(req: any): string {
    const pattern: string | undefined = req?.route?.path;
    if (pattern) {
      const base: string = req?.baseUrl ?? '';
      return `${base}${pattern}` || pattern;
    }
    return '(unmatched)';
  }
}
