import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../common/prisma.service';
import { AccessService } from '../common/access.service';
import { AuditService } from '../common/audit.service';
import { parse } from '../common/zod';
import { StorageService } from '../documents/storage.service';
import { EntitlementsService } from '../features/entitlements.service';
import type { AuthUser } from '../auth/auth.types';
import { zip } from './xlsx-writer';

/**
 * "Send reports to your CA" (owner, 25 Nov 2026): the client picks Flipkart or Amazon and downloads last month's CA files
 * (downloaded by the portal bot on the 5th) in one click. Older months come through the manager, who has them fetched the
 * same way; the client then downloads them from the notification.
 */
export const CA_KINDS: Record<'FLIPKART' | 'AMAZON', { kind: string; label: string }[]> = {
  FLIPKART: [{ kind: 'FLIPKART_GSTR_REPORT', label: 'GSTR return report' }, { kind: 'FLIPKART_SALES_REPORT', label: 'Sales report' }, { kind: 'FLIPKART_TDS', label: 'TDS report' }],
  AMAZON: [{ kind: 'AMAZON_MTR_B2B', label: 'Merchant Tax Report B2B' }, { kind: 'AMAZON_MTR_B2C', label: 'Merchant Tax Report B2C' }, { kind: 'AMAZON_FEE_INVOICE', label: 'Seller fee invoices' }],
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthLabel = (p: string) => `${MONTHS[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;
/** Last month in India. */
export const lastMonthIst = (now = new Date()) => { const ist = new Date(now.getTime() + 5.5 * 3_600_000); return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() - 1, 1)).toISOString().slice(0, 7); };
const Q = z.object({ mp: z.enum(['FLIPKART', 'AMAZON']).default('FLIPKART'), period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional() });
const EXT: Record<string, string> = { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx', 'application/zip': 'zip', 'application/pdf': 'pdf', 'text/csv': 'csv' };

@Injectable()
export class CaFilesService {
  constructor(
    private readonly db: PrismaService, private readonly access: AccessService, private readonly audit: AuditService,
    private readonly storage: StorageService, private readonly ent: EntitlementsService,
  ) {}

  async files(orgId: string, mp: 'FLIPKART' | 'AMAZON', period: string) {
    const kinds = CA_KINDS[mp];
    const docs = await this.db.document.findMany({ where: { organizationId: orgId, deletedAt: null, visibility: 'CLIENT', kind: { in: kinds.map((k) => k.kind) }, periodMonth: new Date(`${period}-01T00:00:00Z`) }, orderBy: { createdAt: 'desc' } });
    return kinds.map((k) => { const d = docs.find((x) => x.kind === k.kind); return { kind: k.kind, label: k.label, id: d?.id ?? null, fileName: d?.fileName ?? null, sizeBytes: d?.sizeBytes ?? null, mimeType: d?.mimeType ?? null, fileKey: d?.fileKey ?? null, addedAt: d?.createdAt ?? null }; });
  }

  private async ctx(user: AuthUser, orgId: string, q: unknown) {
    await this.access.assertOrg(user, orgId);
    if (user.type === 'CUSTOMER' && !this.ent.check(await this.ent.context(orgId), 'CA_DOCUMENTATION').allowed) throw new ForbiddenException('An active plan is needed for CA documents');
    const d = parse(Q, q);
    return { mp: d.mp, period: d.period ?? lastMonthIst() };
  }

  async list(user: AuthUser, orgId: string, q: unknown) {
    const { mp, period } = await this.ctx(user, orgId, q);
    const files = (await this.files(orgId, mp, period)).map(({ fileKey: _k, ...f }) => f);
    return { marketplace: mp, period, label: monthLabel(period), lastMonth: period === lastMonthIst(), files, ready: files.every((f) => f.id), any: files.some((f) => f.id) };
  }

  /** One click: every file of the month in one .zip. */
  async zip(user: AuthUser, orgId: string, q: unknown) {
    const { mp, period } = await this.ctx(user, orgId, q);
    const files = (await this.files(orgId, mp, period)).filter((f) => f.fileKey);
    if (!files.length) throw new NotFoundException(`No ${mp === 'FLIPKART' ? 'Flipkart' : 'Amazon'} CA files for ${monthLabel(period)} yet`);
    const entries = [];
    for (const f of files) entries.push({ name: `${mp === 'FLIPKART' ? 'Flipkart' : 'Amazon'} ${f.label} ${monthLabel(period)}.${EXT[f.mimeType ?? ''] ?? (f.fileName?.split('.').pop() || 'xlsx')}`, data: await this.storage.get(f.fileKey!) });
    await this.audit.log({ actor: user, action: 'ca.files_downloaded', entity: 'Organization', entityId: orgId, organizationId: orgId, after: { mp, period, files: files.length } });
    return { fileName: `SOLLUNA-CA-${mp === 'FLIPKART' ? 'Flipkart' : 'Amazon'}-${period}.zip`, buf: zip(entries) };
  }
}
