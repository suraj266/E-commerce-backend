import { Controller, Headers, HttpCode, Post, Req, Res } from '@nestjs/common';
import { CourierService } from './courier.service';

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
  constructor(private readonly courier: CourierService) {}

  @Post('courier')
  @HttpCode(200)
  async courier_(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    @Req() req: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    @Res() res: any,
    @Headers('x-api-key') apiKey: string,
  ) {
    try {
      await this.courier.handleWebhook(req.body, apiKey ?? '');
      return res.json({ status: 'ok' });
    } catch (error) {
      return res.json({ status: 'error', message: (error as Error).message });
    }
  }
}
