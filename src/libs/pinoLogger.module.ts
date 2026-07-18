import { config } from "@/common/config/config";
import { CORRELATION_ID_HEADER } from "@/common/context/request-context";
import { Module } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { LoggerModule } from "nestjs-pino";

// Exported so it can be unit-tested against a real pino instance. Never log
// secrets: header names are lower-cased by Node, and paths cover the common
// credential-bearing request headers plus any nested password/keySecret/
// credentials/... fields that slip into a logged object. Values → '[REDACTED]'.
export const redactOptions = {
    paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-razorpay-signature"]',
        'req.headers["x-api-key"]',
        'res.headers["set-cookie"]',
        'password',
        '*.password',
        'keySecret',
        '*.keySecret',
        'credentials',
        '*.credentials',
        'accountNumber',
        '*.accountNumber',
        'secretAccessKey',
        '*.secretAccessKey',
    ],
    censor: '[REDACTED]',
};

const transport = config.NODE_ENV !== 'production' ? {
    target: 'pino-pretty',
    options: {
        colorize: true,
        ignore: 'pid,hostname',
        translateTime: 'SYS:dd-mm-yyyy HH:MM:ss',
        singleLine: true,
    },
} : undefined;

@Module({
    imports: [
        LoggerModule.forRoot({
            pinoHttp: {
                transport,
                // Correlation id: honour an inbound `x-request-id` (set by an
                // upstream proxy/CDN) so the id spans the whole edge→app hop;
                // otherwise mint one. Echo it back on the response header so
                // callers/log aggregators can join client + server traces.
                // The value becomes `req.id`, which RequestContextMiddleware
                // then seeds into the AsyncLocalStorage.
                genReqId: (req: any, res: any) => {
                    const existingHeader = req.headers?.[CORRELATION_ID_HEADER];
                    const id =
                        req.id ||
                        (Array.isArray(existingHeader) ? existingHeader[0] : existingHeader) ||
                        randomUUID();
                    if (!res.getHeader?.(CORRELATION_ID_HEADER)) {
                        res.setHeader?.(CORRELATION_ID_HEADER, id);
                    }
                    return id;
                },
                // Stamp the correlation id onto every log line as `requestId`.
                customProps: (req: any) => ({ requestId: req.id }),
                redact: redactOptions,
            },
        }),
    ],
})
export class PinoLoggerModule { }
