import { NestFactory } from '@nestjs/core';
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
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.use(helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: false,
  }));
  app.use(compression());
  app.use(cookieParser());
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useLogger(app.get(Logger));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableCors({ origin: config.FRONTEND_URL, credentials: true });
  await app.listen(config.PORT);
  console.log(`Application is running on: ${await app.getUrl()}`);
}
bootstrap();