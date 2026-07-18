import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { Injectable, NestMiddleware } from '@nestjs/common';

/**
 * Per-request correlation context.
 *
 * We keep a tiny store (`{ correlationId }`) in an AsyncLocalStorage so any
 * code — services, filters, the pino `customProps` hook, Sentry tags — can
 * read the current request's correlation id without threading it through every
 * function signature. The id itself is the same value pino uses as `req.id`
 * (see `pinoLogger.module.ts` `genReqId`), so logs, the `x-request-id`
 * response header, and Sentry events all line up.
 */
export interface RequestStore {
  correlationId: string;
}

const als = new AsyncLocalStorage<RequestStore>();

/** Header carrying the correlation id in/out of the service. */
export const CORRELATION_ID_HEADER = 'x-request-id';

/**
 * Returns the current request's correlation id, or `undefined` when called
 * outside a request scope (e.g. app bootstrap, scheduled jobs).
 */
export function getCorrelationId(): string | undefined {
  return als.getStore()?.correlationId;
}

/** Run `fn` with the given correlation id bound to the async context. */
export function runWithCorrelationId<T>(correlationId: string, fn: () => T): T {
  return als.run({ correlationId }, fn);
}

/**
 * Middleware that seeds the AsyncLocalStorage for each request with the
 * correlation id, so downstream services / the exception filter / Sentry can
 * read it via getCorrelationId().
 *
 * It is written to be order-independent w.r.t. nestjs-pino's middleware (whose
 * registration order relative to a root-module middleware isn't guaranteed):
 *   - if pino ran first, `req.id` is already set (by pino's genReqId) — reuse it;
 *   - if this ran first, derive the id from the `x-request-id` header or mint
 *     one, then backfill `req.id` + the request header so pino's genReqId (which
 *     reads the header) resolves to the SAME value.
 * Either way a single id spans the log lines, the `x-request-id` response
 * header, and any captured Sentry event.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  use(req: any, res: any, next: () => void) {
    const headerVal = req?.headers?.[CORRELATION_ID_HEADER];
    const fromHeader = Array.isArray(headerVal) ? headerVal[0] : headerVal;
    const correlationId = String(req?.id || fromHeader || randomUUID());
    // Backfill so a later-running pino genReqId resolves to the same id, and so
    // the caller always gets the id echoed back.
    if (req) {
      req.id = req.id || correlationId;
      if (req.headers) req.headers[CORRELATION_ID_HEADER] = correlationId;
    }
    if (typeof res?.getHeader === 'function' && !res.getHeader(CORRELATION_ID_HEADER)) {
      res.setHeader?.(CORRELATION_ID_HEADER, correlationId);
    }
    als.run({ correlationId }, () => next());
  }
}
