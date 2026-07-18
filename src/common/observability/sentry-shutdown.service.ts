import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';

/**
 * Flushes buffered Sentry events on graceful shutdown. Registered as a provider
 * so `app.enableShutdownHooks()` (SIGTERM/SIGINT) invokes onApplicationShutdown.
 *
 * `Sentry.close()` is a clean no-op when the SDK was initialised disabled (no
 * DSN), so this is safe in every environment. Bounded to 2s so a slow/unreachable
 * Sentry ingest endpoint can never stall a rolling deploy's drain.
 */
@Injectable()
export class SentryShutdownService implements OnApplicationShutdown {
  private readonly logger = new Logger(SentryShutdownService.name);

  async onApplicationShutdown(signal?: string): Promise<void> {
    try {
      await Sentry.close(2000);
    } catch (err) {
      this.logger.warn(
        `Sentry flush on shutdown (${signal ?? 'n/a'}) failed: ${(err as Error).message}`,
      );
    }
  }
}
