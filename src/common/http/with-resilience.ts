/**
 * Outbound resilience primitives — timeouts + bounded, jittered retry.
 *
 * Every network call this backend makes to a third party (Shiprocket, SMTP,
 * S3) can hang on a dead socket or fail transiently. These helpers wrap an
 * arbitrary async operation with:
 *
 *   - `withTimeout`     — hard-caps wall-clock time via an AbortController and
 *                         a timer; rejects with a `TimeoutError` if the op
 *                         doesn't settle in time. Passes an AbortSignal to the
 *                         op so a fetch/SDK call can actually cancel in-flight.
 *   - `isTransientError`— classifies an error as retry-worthy: network faults
 *                         (ECONNRESET / ETIMEDOUT / abort) and HTTP 429/5xx.
 *                         4xx (except 429) is a caller error — never retried.
 *   - `withResilience`  — timeout + exponential-backoff-with-jitter retry,
 *                         gated on a caller-supplied `retryOn` predicate
 *                         (default: `isTransientError`).
 *
 * DESIGN RULE (load-bearing): only IDEMPOTENT reads may use `withResilience`.
 * Non-idempotent writes (create shipment, assign AWB, schedule pickup, send
 * email) MUST use `withTimeout` ONLY — a request that times out may have
 * succeeded server-side, so a retry risks a duplicate side effect.
 *
 * All failures are logged with the current request's correlation id (via
 * `getCorrelationId()`) so an outbound fault lines up with its request trace.
 */

import { Logger } from '@nestjs/common';

import { getCorrelationId } from '@/common/context/request-context';

const resilienceLogger = new Logger('OutboundResilience');

/** Error thrown when an operation exceeds its timeout budget. */
export class TimeoutError extends Error {
  readonly code = 'ETIMEDOUT';
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

export interface WithTimeoutOptions {
  /** Milliseconds before the operation is aborted and rejected. */
  timeoutMs: number;
  /** Label used in the timeout message + failure logs (e.g. "shiprocket createShipment"). */
  label?: string;
  /**
   * An optional caller-owned signal. When it aborts, the operation aborts too
   * (the effective signal is the caller's OR the internal timeout).
   */
  signal?: AbortSignal;
}

/**
 * Run `op` with a hard wall-clock timeout. `op` receives an `AbortSignal` that
 * fires when the timeout elapses (or the caller's `signal` aborts) so a
 * cancellation-aware call (fetch, AWS SDK) can stop in-flight work.
 *
 * Rejects with `TimeoutError` on timeout. Any error from `op` propagates as-is.
 */
export async function withTimeout<T>(
  op: (signal: AbortSignal) => Promise<T>,
  options: WithTimeoutOptions,
): Promise<T> {
  const { timeoutMs, label = 'operation' } = options;
  const controller = new AbortController();

  // Chain the caller's signal into ours so an external abort also cancels op.
  const onExternalAbort = () => controller.abort(options.signal?.reason);
  if (options.signal) {
    if (options.signal.aborted) controller.abort(options.signal.reason);
    else options.signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    // Don't keep the event loop alive solely for this timer.
    if (typeof timer.unref === 'function') timer.unref();
  });

  try {
    return await Promise.race([op(controller.signal), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
    if (options.signal) options.signal.removeEventListener('abort', onExternalAbort);
  }
}

/**
 * Best-effort extraction of an HTTP status code from a thrown error. Handles
 * the shapes produced by fetch wrappers, the AWS SDK (`$metadata.httpStatusCode`
 * / `statusCode`), and our own thrown errors that stash a `status`.
 */
export function extractStatus(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const e = err as Record<string, any>;
  const candidates = [
    e.status,
    e.statusCode,
    e.$metadata?.httpStatusCode,
    e.response?.status,
    e.response?.statusCode,
  ];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n >= 100 && n < 600) return n;
  }
  return undefined;
}

/**
 * Classify an error as transient (worth retrying) vs. permanent.
 *
 *   - HTTP 429 (rate limited) and 5xx (server error) → transient.
 *   - Any other HTTP status (i.e. 4xx) → permanent (caller error), NOT retried.
 *   - No status → inspect the error code/name for network faults + timeouts.
 */
export function isTransientError(err: unknown): boolean {
  const status = extractStatus(err);
  if (status !== undefined) {
    return status === 429 || status >= 500;
  }

  if (!err || typeof err !== 'object') return false;
  const e = err as Record<string, any>;
  const code = String(e.code ?? '').toUpperCase();
  const name = String(e.name ?? '');

  // AbortController-driven timeouts + our own TimeoutError.
  if (name === 'TimeoutError' || name === 'AbortError') return true;
  if (code === 'ABORT_ERR') return true;

  const transientCodes = new Set([
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ESOCKETTIMEDOUT',
    'ECONNABORTED',
    'EPIPE',
    'EAI_AGAIN',
    'ENOTFOUND',
    'ENETUNREACH',
    'EHOSTUNREACH',
    'EPROTO',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_BODY_TIMEOUT',
    'UND_ERR_SOCKET',
  ]);
  return transientCodes.has(code);
}

export interface WithResilienceOptions extends WithTimeoutOptions {
  /**
   * Max RETRY attempts after the initial try (so `retries: 2` means up to 3
   * total invocations). Defaults to 2.
   */
  retries?: number;
  /** Base backoff in ms for the exponential schedule. Defaults to 300. */
  baseDelayMs?: number;
  /** Upper bound on any single backoff delay. Defaults to 5000. */
  maxDelayMs?: number;
  /**
   * Predicate deciding whether a given error is retry-worthy. Defaults to
   * `isTransientError`. Return `false` to fail fast (e.g. on a 4xx).
   */
  retryOn?: (err: unknown) => boolean;
  /** Injectable sleep — overridable in tests to avoid real timers. */
  sleepFn?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (typeof t.unref === 'function') t.unref();
  });

/**
 * Full outbound resilience: each attempt is bounded by `withTimeout`, and on a
 * retry-worthy failure we back off (exponential + full jitter) and try again,
 * up to `retries` times. Non-retryable errors (per `retryOn`) throw
 * immediately.
 *
 * ONLY for idempotent operations — see the module-level DESIGN RULE.
 */
export async function withResilience<T>(
  op: (signal: AbortSignal) => Promise<T>,
  options: WithResilienceOptions,
): Promise<T> {
  const {
    retries = 2,
    baseDelayMs = 300,
    maxDelayMs = 5000,
    retryOn = isTransientError,
    sleepFn = defaultSleep,
    label = 'operation',
  } = options;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await withTimeout(op, options);
    } catch (err) {
      lastErr = err;
      const isLast = attempt === retries;
      const retryable = retryOn(err);

      if (!retryable || isLast) {
        resilienceLogger.warn(
          `Outbound "${label}" failed (attempt ${attempt + 1}/${retries + 1}, ` +
            `retryable=${retryable}): ${(err as Error)?.message ?? err}`,
          buildLogMeta(),
        );
        throw err;
      }

      // Exponential backoff with full jitter: random in [0, min(cap, base*2^n)].
      const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      const delay = Math.floor(Math.random() * ceiling);
      resilienceLogger.warn(
        `Outbound "${label}" transient failure (attempt ${attempt + 1}/${retries + 1}), ` +
          `retrying in ${delay}ms: ${(err as Error)?.message ?? err}`,
        buildLogMeta(),
      );
      await sleepFn(delay);
    }
  }
  // Unreachable — the loop either returns or throws — but satisfies the compiler.
  throw lastErr;
}

/** Correlation-id-tagged log metadata, omitted cleanly when out of request scope. */
function buildLogMeta(): string {
  const correlationId = getCorrelationId();
  return correlationId ? `correlationId=${correlationId}` : 'correlationId=-';
}
