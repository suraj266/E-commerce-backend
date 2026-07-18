// MUST be first: initialises Sentry (no-op when SENTRY_DSN is unset) before any
// other module is imported so auto-instrumentation can hook NestJS/HTTP.
import './instrument';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { config } from './common/config/config';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/filters/allExceptions.filter';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { ResponseInterceptor } from './common/interceptors/response.intercepter';

async function bootstrap() {
  // rawBody: true captures the unparsed request body on `req.rawBody` so gateway
  // webhooks (Razorpay) can HMAC-verify the exact bytes that were signed. Without
  // it, signature verification is impossible and every real webhook is dropped.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });
  const logger = app.get(Logger);
  app.use(
    helmet({
      crossOriginEmbedderPolicy: false,
      contentSecurityPolicy: false,
    }),
  );
  app.use(compression());
  app.use(cookieParser());
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useLogger(logger);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableCors({ origin: config.FRONTEND_URL, credentials: true });
  // Register SIGTERM/SIGINT handlers so Nest lifecycle hooks fire on shutdown —
  // in particular PrismaService.onModuleDestroy ($disconnect) and in-flight
  // request draining, which matters for zero-downtime rolling deploys. This
  // also fires SentryShutdownService.onApplicationShutdown, which flushes
  // buffered Sentry events (no-op when the SDK is disabled).
  app.enableShutdownHooks();
  // Bind all interfaces so the container's port publish + healthcheck can reach it.
  await app.listen(config.PORT, '0.0.0.0');
  logger.log(`Application is running on: ${await app.getUrl()}`, 'Bootstrap');
}
bootstrap();
