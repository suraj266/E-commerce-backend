import pino from 'pino';
import { redactOptions } from '@/libs/pinoLogger.module';
import {
    RequestContextMiddleware,
    getCorrelationId,
    runWithCorrelationId,
} from './request-context';

describe('request-context', () => {
    it('returns undefined outside any request scope', () => {
        expect(getCorrelationId()).toBeUndefined();
    });

    it('exposes the correlation id inside runWithCorrelationId', () => {
        runWithCorrelationId('abc-123', () => {
            expect(getCorrelationId()).toBe('abc-123');
        });
        // ...and unwinds afterwards.
        expect(getCorrelationId()).toBeUndefined();
    });

    it('isolates ids across concurrent async contexts', async () => {
        const seen: string[] = [];
        await Promise.all([
            new Promise<void>((resolve) =>
                runWithCorrelationId('req-A', async () => {
                    await Promise.resolve();
                    seen.push(getCorrelationId()!);
                    resolve();
                }),
            ),
            new Promise<void>((resolve) =>
                runWithCorrelationId('req-B', async () => {
                    await Promise.resolve();
                    seen.push(getCorrelationId()!);
                    resolve();
                }),
            ),
        ]);
        expect(seen.sort()).toEqual(['req-A', 'req-B']);
    });

    describe('RequestContextMiddleware', () => {
        const mw = new RequestContextMiddleware();

        /** Minimal fake response tracking headers. */
        function fakeRes() {
            const headers: Record<string, string> = {};
            return {
                headers,
                getHeader: (k: string) => headers[k],
                setHeader: (k: string, v: string) => {
                    headers[k] = v;
                },
            };
        }

        it('reuses req.id (set by pino genReqId) when present', () => {
            const req: any = { id: 'from-req-id', headers: {} };
            let inside: string | undefined;
            mw.use(req, fakeRes(), () => {
                inside = getCorrelationId();
            });
            expect(inside).toBe('from-req-id');
        });

        it('falls back to the x-request-id header when req.id is absent', () => {
            const req: any = { headers: { 'x-request-id': 'hdr-id' } };
            let inside: string | undefined;
            mw.use(req, fakeRes(), () => {
                inside = getCorrelationId();
            });
            expect(inside).toBe('hdr-id');
        });

        it('mints an id, backfills req.id + header, and echoes the response header', () => {
            const req: any = { headers: {} };
            const res = fakeRes();
            let inside: string | undefined;
            mw.use(req, res, () => {
                inside = getCorrelationId();
            });
            expect(inside).toBeTruthy();
            // Backfilled so a later-running pino genReqId resolves the same id.
            expect(req.id).toBe(inside);
            expect(req.headers['x-request-id']).toBe(inside);
            expect(res.getHeader('x-request-id')).toBe(inside);
        });
    });
});

describe('pino redact', () => {
    /** Capture a single serialized log line produced with the redact config. */
    function logAndCapture(obj: Record<string, unknown>): any {
        const chunks: string[] = [];
        const stream = { write: (s: string) => chunks.push(s) };
        const logger = pino({ redact: redactOptions }, stream as any);
        logger.info(obj, 'test');
        return JSON.parse(chunks[0]);
    }

    it('redacts credential-bearing request headers', () => {
        const line = logAndCapture({
            req: {
                headers: {
                    authorization: 'Bearer secret-token',
                    cookie: 'session=abc',
                    'x-razorpay-signature': 'sig',
                    'x-api-key': 'key',
                },
            },
        });
        expect(line.req.headers.authorization).toBe('[REDACTED]');
        expect(line.req.headers.cookie).toBe('[REDACTED]');
        expect(line.req.headers['x-razorpay-signature']).toBe('[REDACTED]');
        expect(line.req.headers['x-api-key']).toBe('[REDACTED]');
    });

    it('redacts the set-cookie response header', () => {
        const line = logAndCapture({ res: { headers: { 'set-cookie': 'x=y' } } });
        expect(line.res.headers['set-cookie']).toBe('[REDACTED]');
    });

    it('redacts nested secret fields on logged objects', () => {
        const line = logAndCapture({
            password: 'p',
            gateway: {
                keySecret: 'ks',
                credentials: 'creds',
                accountNumber: '1234',
                secretAccessKey: 'sak',
            },
        });
        expect(line.password).toBe('[REDACTED]');
        expect(line.gateway.keySecret).toBe('[REDACTED]');
        expect(line.gateway.credentials).toBe('[REDACTED]');
        expect(line.gateway.accountNumber).toBe('[REDACTED]');
        expect(line.gateway.secretAccessKey).toBe('[REDACTED]');
    });

    it('leaves non-secret fields intact', () => {
        const line = logAndCapture({ userId: 'u1', gateway: { name: 'razorpay' } });
        expect(line.userId).toBe('u1');
        expect(line.gateway.name).toBe('razorpay');
    });
});
