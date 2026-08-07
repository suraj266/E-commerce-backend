import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { ConfigService } from '@nestjs/config';
import { SmsChannel, normalisePhone } from './sms.channel';
import { OutboundNotification } from './send-channel.interface';

/**
 * SmsChannel (P4) — config-gating (no-op without creds / template), MSG91 flow
 * POST when configured, and phone normalisation.
 */
describe('SmsChannel', () => {
  let channel: SmsChannel;
  let config: DeepMockProxy<ConfigService>;

  const msg: OutboundNotification = {
    type: 'order_placed',
    title: 'Order placed',
    body: 'Your order is confirmed.',
  };

  /** Build a ConfigService whose get() reads from `env`. */
  function withEnv(env: Record<string, string | undefined>) {
    config = mockDeep<ConfigService>();
    config.get.mockImplementation((key: string) => env[key] as never);
    channel = new SmsChannel(config as unknown as ConfigService);
  }

  afterEach(() => {
    jest.restoreAllMocks();
    delete (global as { fetch?: unknown }).fetch;
  });

  it('is not configured without an API key', () => {
    withEnv({ SMS_PROVIDER: 'msg91' });
    expect(channel.isConfigured()).toBe(false);
  });

  it('is configured with provider + API key', () => {
    withEnv({ SMS_PROVIDER: 'msg91', SMS_API_KEY: 'k' });
    expect(channel.isConfigured()).toBe(true);
  });

  it('no-ops (skipped) when unconfigured', async () => {
    withEnv({});
    const res = await channel.send('9812345678', msg);
    expect(res).toEqual({ sent: false, skipped: true, message: 'SMS not configured' });
  });

  it('no-ops (skipped) when configured but no DLT template', async () => {
    withEnv({ SMS_PROVIDER: 'msg91', SMS_API_KEY: 'k' });
    const res = await channel.send('9812345678', msg);
    expect(res.skipped).toBe(true);
    expect(res.message).toMatch(/template/i);
  });

  it('POSTs the MSG91 flow when fully configured', async () => {
    withEnv({
      SMS_PROVIDER: 'msg91',
      SMS_API_KEY: 'auth-key',
      SMS_DLT_TEMPLATE_ID: 'tmpl-1',
      SMS_SENDER_ID: 'NYXO',
    });
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ type: 'success' }),
    });
    (global as { fetch?: unknown }).fetch = fetchMock;

    const res = await channel.send('9812345678', msg);

    expect(res.sent).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('msg91.com');
    expect(init.headers.authkey).toBe('auth-key');
    const sent = JSON.parse(init.body);
    expect(sent.template_id).toBe('tmpl-1');
    expect(sent.recipients[0].mobiles).toBe('919812345678');
    expect(sent.recipients[0].body).toBe(msg.body);
  });

  it('treats a provider {type:error} response as a soft failure', async () => {
    withEnv({ SMS_PROVIDER: 'msg91', SMS_API_KEY: 'k', SMS_DLT_TEMPLATE_ID: 't' });
    (global as { fetch?: unknown }).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ type: 'error', message: 'bad template' }),
    });

    const res = await channel.send('9812345678', msg);
    expect(res.sent).toBe(false);
    expect(res.message).toBe('bad template');
  });

  describe('normalisePhone', () => {
    it('prefixes the country code to a bare 10-digit number', () => {
      expect(normalisePhone('9812345678', '91')).toBe('919812345678');
    });
    it('keeps a number that already carries a country code', () => {
      expect(normalisePhone('+91 98123 45678', '91')).toBe('919812345678');
    });
    it('returns null for too-short input', () => {
      expect(normalisePhone('12345', '91')).toBeNull();
    });
  });
});
