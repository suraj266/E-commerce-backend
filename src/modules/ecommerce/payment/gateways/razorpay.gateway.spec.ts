import { createHmac } from 'crypto';
import { RazorpayGateway } from './razorpay.gateway';

/**
 * These pure signature checks gate whether real money is accepted as genuine,
 * so they must be tested. Uses fixed secrets + known HMAC vectors — no network.
 */
describe('RazorpayGateway signature verification', () => {
  const KEY_SECRET = 'test_key_secret';
  const WEBHOOK_SECRET = 'test_webhook_secret';
  let gw: RazorpayGateway;

  beforeAll(() => {
    gw = new RazorpayGateway();
    gw.initialize({
      keyId: 'rzp_test_123',
      keySecret: KEY_SECRET,
      webhookSecret: WEBHOOK_SECRET,
    });
  });

  it('verifyPayment accepts a correctly-signed order|payment', async () => {
    const gatewayOrderId = 'order_ABC';
    const gatewayPaymentId = 'pay_XYZ';
    const gatewaySignature = createHmac('sha256', KEY_SECRET)
      .update(`${gatewayOrderId}|${gatewayPaymentId}`)
      .digest('hex');

    await expect(
      gw.verifyPayment({ gatewayOrderId, gatewayPaymentId, gatewaySignature }),
    ).resolves.toBe(true);
  });

  it('verifyPayment rejects a tampered signature', async () => {
    const gatewayOrderId = 'order_ABC';
    const gatewayPaymentId = 'pay_XYZ';
    const good = createHmac('sha256', KEY_SECRET)
      .update(`${gatewayOrderId}|${gatewayPaymentId}`)
      .digest('hex');
    const tampered = good.slice(0, -1) + (good.endsWith('0') ? '1' : '0');

    await expect(
      gw.verifyPayment({
        gatewayOrderId,
        gatewayPaymentId,
        gatewaySignature: tampered,
      }),
    ).resolves.toBe(false);
  });

  it('verifyWebhook accepts a correct HMAC over the raw body and rejects a tampered one', () => {
    const rawBody = Buffer.from('{"event":"payment.captured","x":1}');
    const good = createHmac('sha256', WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex');
    expect(gw.verifyWebhook(rawBody, good)).toBe(true);

    const tampered = good.slice(0, -1) + (good.endsWith('0') ? '1' : '0');
    expect(gw.verifyWebhook(rawBody, tampered)).toBe(false);
  });

  it('verifyWebhook rejects when no webhook secret is configured', () => {
    const bare = new RazorpayGateway();
    bare.initialize({ keyId: 'rzp_test_123', keySecret: KEY_SECRET });
    const rawBody = Buffer.from('{}');
    const sig = createHmac('sha256', '').update(rawBody).digest('hex');
    expect(bare.verifyWebhook(rawBody, sig)).toBe(false);
  });
});
