import { Injectable, ServiceUnavailableException, BadGatewayException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { config } from '../common/config';

export interface RazorpayOrder { id: string; amount: number; currency: string; receipt: string; status: string }

function safeEqualHex(a: string, b: string) {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Razorpay over its REST API + Node crypto — no SDK dependency.
 * Docs: Orders API (POST /v1/orders), Checkout signature = HMAC_SHA256(order_id|payment_id, key_secret),
 * Webhook signature = HMAC_SHA256(raw_body, webhook_secret) in X-Razorpay-Signature.
 */
@Injectable()
export class RazorpayClient {
  get configured() { return Boolean(config.razorpay.keyId && config.razorpay.keySecret); }
  get keyId() { return config.razorpay.keyId!; }

  async createOrder(amountPaise: number, receipt: string, notes: Record<string, string>): Promise<RazorpayOrder> {
    if (!this.configured) throw new ServiceUnavailableException('Payments are not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET)');
    const auth = Buffer.from(`${config.razorpay.keyId}:${config.razorpay.keySecret}`).toString('base64');
    const r = await fetch(`${config.razorpay.apiBase}/v1/orders`, {
      method: 'POST',
      headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' },
      body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt, notes }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new BadGatewayException(`Razorpay order creation failed (HTTP ${r.status})`);
    return (await r.json()) as RazorpayOrder;
  }

  verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): boolean {
    if (!config.razorpay.keySecret) return false;
    const expected = createHmac('sha256', config.razorpay.keySecret).update(`${orderId}|${paymentId}`).digest('hex');
    return safeEqualHex(expected, signature);
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
    if (!config.razorpay.webhookSecret || !signature) return false;
    const expected = createHmac('sha256', config.razorpay.webhookSecret).update(rawBody).digest('hex');
    return safeEqualHex(expected, signature);
  }
}
