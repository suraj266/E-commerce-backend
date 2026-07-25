import { Controller, Headers, HttpCode, Logger, Post, Req, Res } from '@nestjs/common';
import { getCorrelationId } from '@/common/context/request-context';
import { CourierService } from './courier.service';
import { MetricsService } from '@/modules/observability/metrics/metrics.service';

/**
 * One shared webhook endpoint fronts every courier provider, so the metric is
 * labelled with the generic `courier` provider rather than a specific carrier
 * (the carrier is only known after per-account verification inside the service).
 */
const COURIER_PROVIDER = 'courier';

/**
 * Inbound courier tracking webhook — ONE open endpoint for every provider/seller.
 *
 * Route is `/webhooks/courier` (NOT `/webhooks/shiprocket`): Shiprocket rejects
 * webhook URLs containing "shiprocket"/"kartrocket"/"sr"/"kr". The seller pastes
 * this URL into their courier panel and sets a token; the provider sends that
 * token back as `x-api-key`, verified per-account inside handleWebhook.
 *
 * Uses `@Res()` + `res.json()` (like the payment webhook) so the global
 * ResponseInterceptor doesn't double-wrap, and always returns 200 so providers
 * don't retry-storm.
 */
@Controller('webhooks')
export class CourierWebhookController {
  private readonly logger = new Logger(CourierWebhookController.name);

  constructor(
    private readonly courier: CourierService,
    // Optional trailing param (MetricsModule is @Global). Counters are
    // side-effect-only and guarded with `?.` — never affect the response.
    private readonly metrics?: MetricsService,
  ) {}

  /** POST /webhooks/courier — one endpoint for all couriers; courier webhook authenticated by x-api-key signature, not user auth. Always returns 200. */
  @Post('courier')
  @HttpCode(200)
  async courier_(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    @Req() req: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    @Res() res: any,
    @Headers('x-api-key') apiKey: string,
  ) {
    this.metrics?.recordWebhookReceived(COURIER_PROVIDER);
    try {
      await this.courier.handleWebhook(req.body, apiKey ?? '');
      return res.json({ status: 'ok' });
    } catch (error) {
      this.metrics?.recordWebhookFailed(COURIER_PROVIDER);
      // Still return 200 so providers don't retry-storm, but no longer swallow
      // the failure silently: log it (with the correlation id) so it lands in
      // the structured logs + Sentry pipeline and can actually be investigated.
      const err = error as Error;
      this.logger.error(
        `Courier webhook processing failed (correlationId=${getCorrelationId() ?? 'n/a'}): ${err.message}`,
        err.stack,
      );
      return res.json({ status: 'error', message: err.message });
    }
  }
}
