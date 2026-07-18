/**
 * Sentry bootstrap — MUST be imported as the very first line of `main.ts`,
 * before any other import, so Sentry can auto-instrument NestJS/HTTP before
 * those modules are evaluated.
 *
 * Everything here is a clean no-op when `SENTRY_DSN` is unset: `Sentry.init`
 * is called with `enabled: false`, so no network calls, no overhead, and
 * `captureException` becomes a silent noop. This keeps local/dev + any env
 * without a DSN completely unaffected.
 */
import * as Sentry from '@sentry/nestjs';

const dsn = process.env.SENTRY_DSN;

Sentry.init({
  // A missing DSN disables the SDK entirely — no transport, no captures.
  enabled: !!dsn,
  dsn: dsn || undefined,
  environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
  // Tracing is opt-in via env; defaults to 0 (errors only) so we never pay for
  // performance transactions unless explicitly turned on.
  tracesSampleRate: process.env.SENTRY_TRACES_SAMPLE_RATE
    ? Number(process.env.SENTRY_TRACES_SAMPLE_RATE)
    : 0,
});
