import { createHmac } from 'crypto';
import { RazorpayGateway, describeRazorpayError } from './razorpay.gateway';

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

/**
 * Prefill is what stops Razorpay Checkout interrupting the buyer with its
 * "Contact details" step for data we already hold. Exercised through the
 * `existingGatewayOrderId` branch, which reuses a prior gateway order and so
 * builds the payload without touching the network.
 */
describe('RazorpayGateway checkout prefill', () => {
  let gw: RazorpayGateway;

  beforeEach(() => {
    gw = new RazorpayGateway();
    gw.initialize({ keyId: 'rzp_test_123', keySecret: 'secret' });
  });

  const base = {
    orderId: 'order-1',
    orderNumber: 'ORD-1',
    amount: 654.43,
    currency: 'INR',
    method: 'CARD' as never,
    existingGatewayOrderId: 'order_EXISTING',
  };

  it('passes email, contact and name through to the checkout payload', async () => {
    const res = await gw.createSession({
      ...base,
      customerEmail: 'buyer@demo.test',
      customerPhone: '9876543210',
      customerName: 'Demo Customer',
    });

    expect(res.clientPayload.prefill).toEqual({
      email: 'buyer@demo.test',
      contact: '9876543210',
      name: 'Demo Customer',
    });
    // Amount must reach Razorpay in paise, not rupees.
    expect(res.clientPayload.amount).toBe(65443);
  });

  it('omits absent fields rather than sending empty strings', async () => {
    const res = await gw.createSession({
      ...base,
      customerEmail: 'buyer@demo.test',
      // no phone (address had none AND the account has none), no name
    });

    expect(res.clientPayload.prefill).toEqual({ email: 'buyer@demo.test' });
  });

  it('degrades to an empty prefill when nothing is known', async () => {
    const res = await gw.createSession(base);
    expect(res.clientPayload.prefill).toEqual({});
  });
});

/**
 * The SDK rejects with a PLAIN OBJECT, not an Error. Reading `.message` on it
 * yields undefined, which is how a real gateway rejection reached an operator
 * as the literal string "Gateway refund failed: undefined" — the one piece of
 * information needed to act on it, destroyed at the boundary.
 */
describe('describeRazorpayError', () => {
  it('extracts the description from the SDK error envelope', () => {
    expect(
      describeRazorpayError({
        statusCode: 400,
        error: {
          code: 'BAD_REQUEST_ERROR',
          description: 'The amount is more than the amount captured',
        },
      }),
    ).toBe('The amount is more than the amount captured [BAD_REQUEST_ERROR]');
  });

  it('appends field/source/step, which is what identifies a generic rejection', () => {
    expect(
      describeRazorpayError({
        error: {
          code: 'BAD_REQUEST_ERROR',
          description: 'invalid request sent',
          field: 'amount',
          step: 'payment_initiation',
          source: 'NA',
        },
      }),
    ).toBe(
      'invalid request sent [BAD_REQUEST_ERROR] — field=amount, step=payment_initiation',
    );
  });

  it('includes a meaningful reason but drops Razorpay’s "NA" filler', () => {
    expect(
      describeRazorpayError({
        error: { description: 'Refund failed', reason: 'insufficient_balance' },
      }),
    ).toBe('Refund failed (insufficient_balance)');
    expect(
      describeRazorpayError({
        error: { description: 'Refund failed', reason: 'NA' },
      }),
    ).toBe('Refund failed');
  });

  it('falls back to a real Error, then the status code, then JSON', () => {
    expect(describeRazorpayError(new Error('socket hang up'))).toBe(
      'socket hang up',
    );
    expect(describeRazorpayError({ statusCode: 502 })).toBe(
      'Razorpay returned HTTP 502.',
    );
    expect(describeRazorpayError({ odd: 'shape' })).toBe('{"odd":"shape"}');
  });

  it('never returns undefined, whatever it is handed', () => {
    for (const input of [undefined, null, '', 0, {}, []]) {
      const msg = describeRazorpayError(input);
      expect(typeof msg).toBe('string');
      expect(msg.length).toBeGreaterThan(0);
      expect(msg).not.toContain('undefined');
    }
  });
});
