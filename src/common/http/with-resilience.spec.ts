import {
  TimeoutError,
  extractStatus,
  isTransientError,
  withResilience,
  withTimeout,
} from './with-resilience';

/** Deterministic, zero-delay sleep so retry tests don't wait on real timers. */
const noSleep = () => Promise.resolve();

describe('with-resilience', () => {
  describe('withTimeout', () => {
    it('resolves with the op result when it settles in time', async () => {
      await expect(
        withTimeout(async () => 'ok', { timeoutMs: 1000, label: 'fast' }),
      ).resolves.toBe('ok');
    });

    it('rejects with TimeoutError when the op exceeds the budget', async () => {
      const hang = () => new Promise<never>(() => {}); // never settles
      await expect(
        withTimeout(hang, { timeoutMs: 10, label: 'slow' }),
      ).rejects.toBeInstanceOf(TimeoutError);
    });

    it('aborts the signal passed to the op on timeout', async () => {
      let aborted = false;
      const op = (signal: AbortSignal) =>
        new Promise<never>((_, reject) => {
          signal.addEventListener('abort', () => {
            aborted = true;
            reject(new Error('aborted'));
          });
        });
      await expect(withTimeout(op, { timeoutMs: 10 })).rejects.toBeDefined();
      expect(aborted).toBe(true);
    });

    it('propagates a non-timeout error from the op unchanged', async () => {
      const boom = async () => {
        throw new Error('boom');
      };
      await expect(withTimeout(boom, { timeoutMs: 1000 })).rejects.toThrow('boom');
    });
  });

  describe('extractStatus', () => {
    it('reads status from common error shapes', () => {
      expect(extractStatus({ status: 503 })).toBe(503);
      expect(extractStatus({ statusCode: 429 })).toBe(429);
      expect(extractStatus({ $metadata: { httpStatusCode: 500 } })).toBe(500);
      expect(extractStatus({ response: { status: 404 } })).toBe(404);
    });

    it('returns undefined when no status is present', () => {
      expect(extractStatus({ code: 'ECONNRESET' })).toBeUndefined();
      expect(extractStatus(new Error('x'))).toBeUndefined();
      expect(extractStatus(null)).toBeUndefined();
    });
  });

  describe('isTransientError classification', () => {
    it('treats 429 and 5xx as transient', () => {
      expect(isTransientError({ status: 429 })).toBe(true);
      expect(isTransientError({ status: 500 })).toBe(true);
      expect(isTransientError({ statusCode: 503 })).toBe(true);
      expect(isTransientError({ $metadata: { httpStatusCode: 502 } })).toBe(true);
    });

    it('treats 4xx (other than 429) as permanent', () => {
      expect(isTransientError({ status: 400 })).toBe(false);
      expect(isTransientError({ status: 401 })).toBe(false);
      expect(isTransientError({ status: 404 })).toBe(false);
      expect(isTransientError({ status: 422 })).toBe(false);
    });

    it('treats network fault codes as transient', () => {
      expect(isTransientError({ code: 'ECONNRESET' })).toBe(true);
      expect(isTransientError({ code: 'ETIMEDOUT' })).toBe(true);
      expect(isTransientError({ code: 'ECONNREFUSED' })).toBe(true);
      expect(isTransientError({ code: 'EAI_AGAIN' })).toBe(true);
    });

    it('treats timeouts / aborts as transient', () => {
      expect(isTransientError(new TimeoutError('t'))).toBe(true);
      expect(isTransientError({ name: 'AbortError' })).toBe(true);
      expect(isTransientError({ code: 'ABORT_ERR' })).toBe(true);
    });

    it('treats plain / unknown errors as permanent', () => {
      expect(isTransientError(new Error('nope'))).toBe(false);
      expect(isTransientError({ code: 'EACCES' })).toBe(false);
      expect(isTransientError(null)).toBe(false);
      expect(isTransientError('string')).toBe(false);
    });
  });

  describe('withResilience', () => {
    it('returns the result on first success without retrying', async () => {
      const op = jest.fn(async () => 'ok');
      await expect(
        withResilience(op, { timeoutMs: 1000, retries: 2, sleepFn: noSleep }),
      ).resolves.toBe('ok');
      expect(op).toHaveBeenCalledTimes(1);
    });

    it('retries transient failures N times then throws (N+1 total attempts)', async () => {
      const op = jest.fn(async () => {
        throw { status: 503, message: 'unavailable' };
      });
      await expect(
        withResilience(op, { timeoutMs: 1000, retries: 2, sleepFn: noSleep }),
      ).rejects.toMatchObject({ status: 503 });
      // initial attempt + 2 retries = 3 invocations
      expect(op).toHaveBeenCalledTimes(3);
    });

    it('succeeds on a later attempt after transient failures', async () => {
      let calls = 0;
      const op = jest.fn(async () => {
        calls += 1;
        if (calls < 3) throw { status: 500 };
        return 'recovered';
      });
      await expect(
        withResilience(op, { timeoutMs: 1000, retries: 3, sleepFn: noSleep }),
      ).resolves.toBe('recovered');
      expect(op).toHaveBeenCalledTimes(3);
    });

    it('does NOT retry when the error is non-transient (4xx)', async () => {
      const op = jest.fn(async () => {
        throw { status: 400, message: 'bad request' };
      });
      await expect(
        withResilience(op, { timeoutMs: 1000, retries: 2, sleepFn: noSleep }),
      ).rejects.toMatchObject({ status: 400 });
      expect(op).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry when retryOn returns false', async () => {
      const op = jest.fn(async () => {
        throw { status: 503 }; // transient by default, but retryOn overrides
      });
      await expect(
        withResilience(op, {
          timeoutMs: 1000,
          retries: 3,
          retryOn: () => false,
          sleepFn: noSleep,
        }),
      ).rejects.toBeDefined();
      expect(op).toHaveBeenCalledTimes(1);
    });

    it('retries a timeout (transient) and eventually throws TimeoutError', async () => {
      const op = jest.fn(() => new Promise<never>(() => {})); // always hangs
      await expect(
        withResilience(op, { timeoutMs: 10, retries: 1, sleepFn: noSleep }),
      ).rejects.toBeInstanceOf(TimeoutError);
      expect(op).toHaveBeenCalledTimes(2); // initial + 1 retry
    });
  });
});
