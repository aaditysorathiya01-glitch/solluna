import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'crypto';

/**
 * Amazon Selling Partner API (official). SOLLUNA's app credentials (LWA client id + secret) live only in the server's
 * environment; each seller's refresh token authorises access to that seller's account. For now one test seller
 * (the owner's own account) via SPAPI_TEST_REFRESH_TOKEN; per-client tokens go to MarketplaceCredential (encrypted).
 * India is served by the EU endpoint; marketplace A21TJRUUN4KGV = Amazon.in.
 */
export const AMAZON_IN = 'A21TJRUUN4KGV';
const LWA_URL = () => process.env.SPAPI_LWA_URL ?? 'https://api.amazon.com/auth/o2/token';
const ENDPOINT = () => (process.env.SPAPI_ENDPOINT ?? 'https://sellingpartnerapi-eu.amazon.com').replace(/\/$/, '');

@Injectable()
export class SpApiService {
  private tokens = new Map<string, { token: string; expires: number }>();

  get configured() { return Boolean(process.env.SPAPI_CLIENT_ID && process.env.SPAPI_CLIENT_SECRET); }
  get testSellerConfigured() { return this.configured && Boolean(process.env.SPAPI_TEST_REFRESH_TOKEN); }

  /** Login with Amazon: refresh token → 1-hour access token (cached per refresh token, never logged). */
  private async accessToken(refreshToken: string, app = { clientId: process.env.SPAPI_CLIENT_ID!, clientSecret: process.env.SPAPI_CLIENT_SECRET! }) {
    const key = createHash('sha256').update(refreshToken).digest('hex');
    const hit = this.tokens.get(key);
    if (hit && hit.expires > Date.now() + 60_000) return hit.token;
    const res = await fetch(LWA_URL(), {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: app.clientId, client_secret: app.clientSecret }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
    if (!res.ok || !body.access_token) throw new ServiceUnavailableException(`Amazon login failed: ${body.error_description ?? body.error ?? `HTTP ${res.status}`}`);
    this.tokens.set(key, { token: body.access_token, expires: Date.now() + (body.expires_in ?? 3600) * 1000 });
    return body.access_token;
  }

  async get<T>(refreshToken: string, path: string, app?: { clientId: string; clientSecret: string }): Promise<T> {
    const res = await fetch(`${ENDPOINT()}${path}`, { signal: AbortSignal.timeout(20_000), headers: { 'x-amz-access-token': await this.accessToken(refreshToken, app), 'user-agent': 'SOLLUNA/2.0 (Language=TypeScript)', accept: 'application/json' } });
    const body = (await res.json().catch(() => ({}))) as T & { errors?: { code: string; message: string }[] };
    if (!res.ok) throw new ServiceUnavailableException(`Amazon SP-API ${res.status}: ${body.errors?.map((e) => `${e.code} ${e.message}`).join('; ') ?? 'error'}`);
    return body;
  }

  /** Checks a seller's own app keys (from the Seller accounts page). */
  async testWith(k: { clientId: string; clientSecret: string; refreshToken: string }) {
    try {
      const r = await this.get<{ payload?: { marketplace: { id: string; name: string; countryCode: string }; participation: { isParticipating: boolean } }[] }>(k.refreshToken, '/sellers/v1/marketplaceParticipations', { clientId: k.clientId, clientSecret: k.clientSecret });
      const marketplaces = (r.payload ?? []).filter((p) => p.participation.isParticipating).map((p) => ({ id: p.marketplace.id, name: p.marketplace.name }));
      return { ok: true as const, marketplaces };
    } catch (e) { return { ok: false as const, message: (e as Error).message }; }
  }

  /** Admin check with the test seller: which marketplaces the account sells in. */
  async testConnection() {
    if (!this.configured) return { ok: false, step: 'config', message: 'Add SPAPI_CLIENT_ID and SPAPI_CLIENT_SECRET in the server environment.' };
    if (!process.env.SPAPI_TEST_REFRESH_TOKEN) return { ok: false, step: 'config', message: 'Add SPAPI_TEST_REFRESH_TOKEN (from Seller Central → Develop Apps → Authorize) in the server environment.' };
    try {
      const r = await this.get<{ payload?: { marketplace: { id: string; name: string; countryCode: string; defaultCurrencyCode: string }; participation: { isParticipating: boolean; hasSuspendedListings: boolean } }[] }>(process.env.SPAPI_TEST_REFRESH_TOKEN, '/sellers/v1/marketplaceParticipations');
      const marketplaces = (r.payload ?? []).map((p) => ({ id: p.marketplace.id, name: p.marketplace.name, country: p.marketplace.countryCode, participating: p.participation.isParticipating, suspendedListings: p.participation.hasSuspendedListings }));
      return { ok: true, step: 'done', amazonIn: marketplaces.some((m) => m.id === AMAZON_IN && m.participating), marketplaces };
    } catch (e) {
      return { ok: false, step: 'amazon', message: (e as Error).message };
    }
  }
}
