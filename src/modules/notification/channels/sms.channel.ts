/**
 * SmsChannel — India-appropriate transactional SMS adapter (Phase 4).
 *
 * Shaped for MSG91's v5 "flow" API (the dominant India DLT-compliant provider):
 * a POST to the flow endpoint with an `authkey` header and a DLT-approved
 * `template_id`. It is CONFIG-GATED via `SMS_*` env and degrades to a logged
 * no-op when unconfigured — the exact soft-fail contract EmailService uses for
 * missing SMTP, so the platform runs end-to-end with zero SMS creds.
 *
 * Only `msg91` is implemented; `SMS_PROVIDER` is an escape hatch so a different
 * India provider can be slotted in later without touching call sites.
 *
 * Transactional intent only: the fan-out sends order/shipping/return SMS as
 * transactional (DLT "service-implicit"/"transactional" category), and gates
 * marketing-class kinds (e.g. back-in-stock) on explicit consent + quiet hours
 * upstream (NotificationDispatchService) — this adapter just delivers.
 *
 * NOTE: India DLT requires the message text to match a registered template.
 * `SMS_DLT_TEMPLATE_ID` selects that template; `title`/`body` are passed as flow
 * variables the registered template must reference. Without a template id the
 * send is a warn+no-op (provider would reject it anyway).
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ChannelSendResult,
  ISendChannel,
  NOTIFICATION_CHANNEL,
  NotificationChannel,
  OutboundNotification,
} from './send-channel.interface';

/** Bound the provider HTTP call so a slow gateway can't stall the fan-out. */
const SMS_HTTP_TIMEOUT_MS = 8000;
const DEFAULT_MSG91_FLOW_URL = 'https://control.msg91.com/api/v5/flow/';
const DEFAULT_COUNTRY_CODE = '91';

@Injectable()
export class SmsChannel implements ISendChannel<string> {
  readonly channel: NotificationChannel = NOTIFICATION_CHANNEL.SMS;
  private readonly logger = new Logger(SmsChannel.name);

  constructor(private readonly config: ConfigService) {}

  /** Provider is supported AND an auth key is present. Template is checked in send(). */
  isConfigured(): boolean {
    return this.provider() === 'msg91' && Boolean(this.apiKey());
  }

  /**
   * Send one SMS to a phone number. `destination` is the recipient's raw phone
   * (any format); it is normalised to `<cc><national>` digits for MSG91.
   */
  async send(
    destination: string,
    message: OutboundNotification,
  ): Promise<ChannelSendResult> {
    if (!this.isConfigured()) {
      this.logger.warn(
        `Skipped SMS "${message.type}" — SMS is not configured (set SMS_PROVIDER + SMS_API_KEY).`,
      );
      return { sent: false, skipped: true, message: 'SMS not configured' };
    }

    const templateId = this.str('SMS_DLT_TEMPLATE_ID');
    if (!templateId) {
      this.logger.warn(
        `Skipped SMS "${message.type}" — SMS_DLT_TEMPLATE_ID is unset (a DLT-approved template is mandatory in India).`,
      );
      return { sent: false, skipped: true, message: 'SMS template not configured' };
    }

    const mobiles = normalisePhone(destination, this.countryCode());
    if (!mobiles) {
      return { sent: false, skipped: true, message: 'invalid phone number' };
    }

    // MSG91 flow payload. The DLT-approved template referenced by `template_id`
    // must declare the `body`/`title` variables sent here.
    const sender = this.str('SMS_SENDER_ID');
    const payload: Record<string, unknown> = {
      template_id: templateId,
      short_url: '0',
      recipients: [
        {
          mobiles,
          body: message.body,
          title: message.title,
        },
      ],
      ...(sender ? { sender } : {}),
    };

    // Bound the provider call (AbortController + timer — the codebase's proven
    // fetch-timeout pattern) so a slow gateway can't stall the fan-out.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SMS_HTTP_TIMEOUT_MS);
    try {
      let res: Response;
      try {
        res = await fetch(this.flowUrl(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            authkey: this.apiKey()!,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      if (!res.ok) {
        const text = await safeText(res);
        this.logger.error(
          `SMS "${message.type}" failed: HTTP ${res.status} ${text}`.trim(),
        );
        return { sent: false, message: `HTTP ${res.status}` };
      }

      // MSG91 returns 200 with `{ type: 'error', message } ` on a logical
      // failure — treat that as a soft failure, not a success.
      const bodyJson = await safeJson(res);
      if (bodyJson && bodyJson.type === 'error') {
        const msg = String(bodyJson.message ?? 'provider error');
        this.logger.error(`SMS "${message.type}" rejected by provider: ${msg}`);
        return { sent: false, message: msg };
      }

      this.logger.log(`Sent SMS "${message.type}" to ${maskPhone(mobiles)}.`);
      return { sent: true };
    } catch (err) {
      const msg = (err as Error).message;
      this.logger.error(`SMS "${message.type}" transport error: ${msg}`);
      return { sent: false, message: msg };
    }
  }

  // ---- config accessors -----------------------------------------------------

  private provider(): string {
    return (this.str('SMS_PROVIDER') ?? 'msg91').toLowerCase();
  }
  private apiKey(): string | undefined {
    return this.str('SMS_API_KEY');
  }
  private flowUrl(): string {
    return this.str('SMS_MSG91_URL') ?? DEFAULT_MSG91_FLOW_URL;
  }
  private countryCode(): string {
    return (this.str('SMS_DEFAULT_COUNTRY_CODE') ?? DEFAULT_COUNTRY_CODE).replace(
      /\D/g,
      '',
    );
  }
  private str(key: string): string | undefined {
    const v = this.config.get<string>(key);
    return v && String(v).trim() !== '' ? String(v).trim() : undefined;
  }
}

/**
 * Normalise a raw phone to MSG91's `<countrycode><national>` digit string.
 * - strips every non-digit,
 * - keeps a number that already carries a country code (>10 digits) as-is,
 * - prefixes the default country code to a bare 10-digit national number.
 * Returns null when nothing usable remains.
 */
export function normalisePhone(raw: string, countryCode: string): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  if (digits.length === 10) return `${countryCode}${digits}`;
  return digits;
}

/** Mask all but the last 4 digits for logs (avoid PII in plaintext logs). */
function maskPhone(digits: string): string {
  return digits.length <= 4
    ? '****'
    : `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`;
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return '';
  }
}

async function safeJson(
  res: Response,
): Promise<{ type?: string; message?: unknown } | null> {
  try {
    return (await res.json()) as { type?: string; message?: unknown };
  } catch {
    return null;
  }
}
