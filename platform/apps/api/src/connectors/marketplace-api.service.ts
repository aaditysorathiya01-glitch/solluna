import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { decrypt, encrypt } from '../common/crypto';
import { parse } from '../common/zod';
import type { AuthUser } from '../auth/auth.types';
import { SpApiService } from './spapi.service';

/**
 * Client's own official API keys (owner, 10 Nov 2026): a seller can connect their account by pasting the keys of their
 * own self-authorised API app — Amazon SP-API (client identifier, client secret, refresh token) or Flipkart Seller API
 * (application ID + secret). Keys are AES-GCM encrypted, write-only (never shown again) and tested at once; a passing
 * test is marketplace evidence, so the account becomes CONNECTED.
 */
const AmazonKeys = z.object({
  clientId: z.string().trim().regex(/^amzn1\.application-oa2-client\.[a-z0-9]+$/i, 'Client identifier starts with amzn1.application-oa2-client.'),
  clientSecret: z.string().trim().min(20).max(500),
  refreshToken: z.string().trim().regex(/^Atzr\|/, 'Refresh token starts with Atzr|').max(2000),
}).strict();
const FlipkartKeys = z.object({
  clientId: z.string().trim().min(6).max(200),
  clientSecret: z.string().trim().min(6).max(500),
}).strict();

const FK_TOKEN_URL = () => process.env.FLIPKART_TOKEN_URL ?? 'https://api.flipkart.net/oauth-service/oauth/token';

@Injectable()
export class MarketplaceApiService {
  constructor(private readonly db: PrismaService, private readonly audit: AuditService, private readonly spapi: SpApiService) {}

  /** Saves (or replaces) the client's keys, then tests them against the marketplace. */
  async save(user: AuthUser, marketplace: string, input: unknown) {
    const orgId = user.organizationId!;
    const mp = parse(z.enum(['AMAZON', 'FLIPKART']), marketplace);
    const keys: { clientId: string; clientSecret: string; refreshToken?: string } = mp === 'AMAZON' ? parse(AmazonKeys, input) : parse(FlipkartKeys, input);
    const account = await this.db.marketplaceAccount.upsert({
      where: { organizationId_marketplace: { organizationId: orgId, marketplace: mp } },
      create: { organizationId: orgId, marketplace: mp, hasAccount: true, status: 'PENDING' },
      update: { hasAccount: true },
    });
    const data = {
      kind: mp === 'AMAZON' ? 'SPAPI_SELF' : 'FLIPKART_SELF',
      encryptedClientId: encrypt(keys.clientId), encryptedClientSecret: encrypt(keys.clientSecret),
      encryptedRefreshToken: encrypt(keys.refreshToken ?? '-'),
      encryptedAccessToken: null, accessTokenExpiresAt: null,
    };
    await this.db.marketplaceCredential.upsert({ where: { marketplaceAccountId: account.id }, create: { marketplaceAccountId: account.id, ...data }, update: data });
    await this.audit.log({ actor: user, action: 'marketplace.api_keys_saved', entity: 'MarketplaceAccount', entityId: account.id, organizationId: orgId, after: { marketplace: mp } });
    return this.test(orgId, mp);
  }

  /** Calls the marketplace with the stored keys; a pass marks the account CONNECTED with the evidence. */
  async test(orgId: string, mp: 'AMAZON' | 'FLIPKART') {
    const account = await this.db.marketplaceAccount.findUnique({ where: { organizationId_marketplace: { organizationId: orgId, marketplace: mp } }, include: { credential: true } });
    const c = account?.credential;
    if (!account || !c?.encryptedClientId || !c.encryptedClientSecret) throw new NotFoundException('No API keys saved');
    let ok = false; let message = '';
    try {
      if (mp === 'AMAZON') {
        const r = await this.spapi.testWith({ clientId: decrypt(c.encryptedClientId), clientSecret: decrypt(c.encryptedClientSecret), refreshToken: decrypt(c.encryptedRefreshToken) });
        ok = r.ok; message = r.ok ? `Amazon API connected — marketplaces: ${r.marketplaces.map((m) => m.name).join(', ')}` : r.message;
      } else {
        const basic = Buffer.from(`${decrypt(c.encryptedClientId)}:${decrypt(c.encryptedClientSecret)}`).toString('base64');
        const res = await fetch(`${FK_TOKEN_URL()}?grant_type=client_credentials&scope=Seller_Api`, { headers: { authorization: `Basic ${basic}`, accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
        const body = (await res.json().catch(() => ({}))) as { access_token?: string; error_description?: string; error?: string };
        ok = res.ok && Boolean(body.access_token);
        message = ok ? 'Flipkart API connected — token issued for the seller account' : `Flipkart refused the keys: ${body.error_description ?? body.error ?? `HTTP ${res.status}`}`;
      }
    } catch (e) { message = `Could not reach ${mp === 'AMAZON' ? 'Amazon' : 'Flipkart'}: ${(e as Error).message}`; }
    await this.db.marketplaceCredential.update({ where: { id: c.id }, data: { lastTestAt: new Date(), lastTestOk: ok, lastTestMessage: message.slice(0, 300) } });
    if (ok && account.status !== 'CONNECTED') {
      await this.db.marketplaceAccount.update({ where: { id: account.id }, data: { status: 'CONNECTED', verifiedNote: `${message} (API test ${new Date().toISOString().slice(0, 10)})`, lastError: null } });
      await this.audit.log({ action: 'marketplace.connected_by_api', entity: 'MarketplaceAccount', entityId: account.id, organizationId: orgId, after: { marketplace: mp } });
    }
    return { marketplace: mp, ok, message, testedAt: new Date() };
  }

  async remove(user: AuthUser, marketplace: string) {
    const mp = parse(z.enum(['AMAZON', 'FLIPKART']), marketplace);
    const account = await this.db.marketplaceAccount.findUnique({ where: { organizationId_marketplace: { organizationId: user.organizationId!, marketplace: mp } } });
    if (!account) throw new BadRequestException('Nothing to remove');
    await this.db.marketplaceCredential.deleteMany({ where: { marketplaceAccountId: account.id } });
    // Connected only through these keys → no longer verified.
    if (account.status === 'CONNECTED' && /API connected/.test(account.verifiedNote ?? '')) await this.db.marketplaceAccount.update({ where: { id: account.id }, data: { status: 'PENDING', verifiedNote: null } });
    await this.audit.log({ actor: user, action: 'marketplace.api_keys_removed', entity: 'MarketplaceAccount', entityId: account.id, organizationId: user.organizationId!, after: { marketplace: mp } });
    return { removed: true };
  }
}
