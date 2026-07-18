import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import * as Sentry from "@sentry/nestjs";
import { getCorrelationId } from "@/common/context/request-context";

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
    private readonly logger = new Logger(AllExceptionsFilter.name);
    catch(exception: any, host: ArgumentsHost) {
        const status = exception instanceof HttpException ? exception.getStatus() : 500;
        const message = exception instanceof HttpException ? exception.getResponse() : "Internal Server Error";
        this.logger.error(exception.message, exception.stack)

        // Only ship genuine faults to Sentry: any non-HttpException (unexpected
        // crash) or a 5xx. Expected 4xx client errors (validation, auth, not
        // found) are noise and are deliberately skipped. Tag with the
        // correlation id so the Sentry event joins the request's log lines.
        if (!(exception instanceof HttpException) || status >= 500) {
            Sentry.captureException(exception, (scope) => {
                const correlationId = getCorrelationId();
                if (correlationId) {
                    scope.setTag('correlationId', correlationId);
                }
                return scope;
            });
        }

        const ctxType = host.getType<string>();
        if (ctxType === 'graphql') {
            throw exception;
        }
        const ctx = host.switchToHttp();
        const response = ctx.getResponse();
        const request = ctx.getRequest();
        response.status(status).json({
            statusCode: status,
            timestamp: new Date().toISOString(),
            path: request.url,
            message: typeof message === 'string' ? message : (message as any).message,
        });
    }
}
