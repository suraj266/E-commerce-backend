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
  app.use(
    helmet({
      crossOriginEmbedderPolicy: false,
      contentSecurityPolicy: false,
    }),
  );
  app.use(compression());
  app.use(cookieParser());
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useLogger(app.get(Logger));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableCors({ origin: config.FRONTEND_URL, credentials: true });
  await app.listen(config.PORT);
  console.log(`Application is running on: ${await app.getUrl()}`);
}
bootstrap();
