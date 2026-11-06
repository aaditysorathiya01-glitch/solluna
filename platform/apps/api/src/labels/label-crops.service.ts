import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit, PayloadTooLargeException } from '@nestjs/common';
import { z } from 'zod';
import { compose, detect } from '../../../../packages/labels/src';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { parse } from '../common/zod';
import { StorageService } from '../documents/storage.service';
import type { UploadedFile } from '../documents/documents.service';
import { DispatcherService } from '../connectors/dispatcher.service';
import { EntitlementsService } from '../features/entitlements.service';
import type { AuthUser } from '../auth/auth.types';
import { extractPages } from './extract';
import { hybridDetect } from './hybrid';

export const MAX_LABEL_PDF_BYTES = 25 * 1024 * 1024;
const MAX_PAGES = 600;
const KEEP_DAYS = 7;
/** PlanFeature.meta.mode for LABEL_CROPPER → what the client may run. Manual runs in the browser. */
const MODES: Record<string, ('MANUAL' | 'AUTO' | 'SPECIAL')[]> = { MANUAL: ['MANUAL'], AUTO_MANUAL: ['AUTO', 'MANUAL'], AUTO_SPECIAL_MANUAL: ['AUTO', 'SPECIAL', 'MANUAL'] };
const CreateSchema = z.object({
  mode: z.enum(['AUTO', 'SPECIAL']),
  layout: z.enum(['A4_4UP', 'A4_6UP', 'THERMAL_4X6']).default('A4_4UP'),
  includeInvoices: z.preprocess((v) => v === true || v === 'true' || v === 'on', z.boolean()).default(false),
});
const PUBLIC = { id: true, mode: true, layout: true, includeInvoices: true, fileName: true, status: true, marketplace: true, labelCount: true, invoiceCount: true, unrecognisedPages: true, reviewPages: true, error: true, createdAt: true, finishedAt: true, expiresAt: true } as const;

/**
 * Label Cropping Tool (skill: shipping-label-generation). Auto and specialised crops are queued and processed by
 * the background loop below, so no PDF work happens inside an HTTP request.
 */
@Injectable()
export class LabelCropsService implements OnModuleInit {
  private readonly log = new Logger('LabelCrops');
  private busy = false;

  constructor(
    private readonly db: PrismaService,
    private readonly ent: EntitlementsService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly dispatch: DispatcherService,
  ) {}

  onModuleInit() {
    setInterval(() => this.tick().catch((e) => this.log.error(e)), 3000).unref();
  }

  /** Modes this client's plan allows, from the database (admin-editable), enforced here — not by the UI. */
  async modes(orgId: string) {
    const e = await this.ent.context(orgId);
    if (!this.ent.check(e, 'LABEL_CROPPER').allowed || !e.subscription) return [];
    const pf = await this.db.planFeature.findUnique({ where: { planId_featureKey: { planId: e.subscription.planId, featureKey: 'LABEL_CROPPER' } } });
    return MODES[(pf?.meta as { mode?: string } | null)?.mode ?? 'MANUAL'] ?? ['MANUAL'];
  }

  async list(user: AuthUser) {
    const orgId = user.organizationId!;
    const [modes, jobs] = await Promise.all([
      this.modes(orgId),
      this.db.labelCropJob.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: 'desc' }, take: 20, select: PUBLIC }),
    ]);
    return { modes, jobs };
  }

  async create(user: AuthUser, file: UploadedFile | undefined, input: unknown) {
    const d = parse(CreateSchema, input);
    const orgId = user.organizationId!;
    if (!file) throw new BadRequestException('Attach the label PDF downloaded from Amazon or Flipkart');
    if (file.size > MAX_LABEL_PDF_BYTES) throw new PayloadTooLargeException('Label PDFs must be under 25 MB — split the day into two files');
    if (file.buffer.subarray(0, 5).toString('latin1') !== '%PDF-') throw new BadRequestException('That file is not a PDF');
    const modes = await this.modes(orgId);
    if (!modes.includes(d.mode)) {
      throw new ForbiddenException(d.mode === 'SPECIAL' ? 'Specialised labels (SKU line, sorting and picklist) are included in the Premium plan' : 'Auto crop is included from the Growth plan. Use Manual crop on your plan.');
    }
    const sourceKey = await this.storage.put(file.buffer);
    const job = await this.db.labelCropJob.create({
      data: { organizationId: orgId, createdById: user.id, mode: d.mode, layout: d.layout, includeInvoices: d.includeInvoices, fileName: safeName(file.originalname), sourceKey, unrecognisedPages: [], reviewPages: [], expiresAt: new Date(Date.now() + KEEP_DAYS * 86_400_000) },
      select: PUBLIC,
    });
    await this.audit.log({ actor: user, action: 'labels.crop_requested', entity: 'LabelCropJob', entityId: job.id, after: { mode: d.mode, layout: d.layout, bytes: file.size } });
    setImmediate(() => this.tick().catch((e) => this.log.error(e)));
    return job;
  }

  async download(user: AuthUser, id: string, ip?: string) {
    const job = await this.db.labelCropJob.findFirst({ where: { id, organizationId: user.organizationId! } });
    if (!job) throw new NotFoundException('Not found');
    if (job.status !== 'DONE' || !job.outputKey) throw new BadRequestException('This file is not ready yet');
    const data = await this.storage.get(job.outputKey);
    await this.audit.log({ actor: user, action: 'labels.crop_download', entity: 'LabelCropJob', entityId: job.id, ip });
    return { fileName: `${job.fileName.replace(/\.pdf$/i, '')}-${job.mode === 'SPECIAL' ? 'specialised' : 'cropped'}.pdf`, data };
  }

  /** One job at a time per process; stale PROCESSING jobs (crash) are retried; expired files are purged. */
  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.db.labelCropJob.updateMany({ where: { status: 'PROCESSING', startedAt: { lt: new Date(Date.now() - 10 * 60_000) } }, data: { status: 'QUEUED' } });
      for (;;) {
        const next = await this.db.labelCropJob.findFirst({ where: { status: 'QUEUED' }, orderBy: { createdAt: 'asc' } });
        if (!next) break;
        const claimed = await this.db.labelCropJob.updateMany({ where: { id: next.id, status: 'QUEUED' }, data: { status: 'PROCESSING', startedAt: new Date() } });
        if (claimed.count) await this.process(next.id);
      }
      await this.purge();
    } finally { this.busy = false; }
  }

  private async process(id: string) {
    const job = await this.db.labelCropJob.findUniqueOrThrow({ where: { id } });
    try {
      if (!job.sourceKey) throw new Error('Source file missing');
      const src = await this.storage.get(job.sourceKey);
      const pages = await extractPages(new Uint8Array(src));
      if (pages.length > MAX_PAGES) throw new Error(`This PDF has ${pages.length} pages; the limit is ${MAX_PAGES}`);
      const found = detect(pages);
      // Pages the marketplace parsers do not know go to the hybrid detector from the original label cropper.
      const hybrid = await hybridDetect(new Uint8Array(src), found.unrecognisedPages);
      const labels = [...found.labels, ...hybrid.labels].sort((a, b) => a.page - b.page);
      if (!labels.length) throw new Error('No shipping labels were recognised in this PDF. Use Manual crop to mark the label area.');
      const marketplace = hybrid.labels.length ? (found.labels.length ? 'MIXED' : 'OTHER') : found.marketplace;
      const out = await compose(new Uint8Array(src), labels, found.invoices, { layout: job.layout as 'A4_4UP' | 'A4_6UP' | 'THERMAL_4X6', specialised: job.mode === 'SPECIAL', includeInvoices: job.includeInvoices });
      const outputKey = await this.storage.put(Buffer.from(out));
      await this.db.labelCropJob.update({ where: { id }, data: { status: 'DONE', outputKey, marketplace, labelCount: labels.length, invoiceCount: found.invoices.length, unrecognisedPages: hybrid.failed.map((p) => p + 1), reviewPages: hybrid.review.map((p) => p + 1), finishedAt: new Date() } });
      const notes = [hybrid.failed.length ? `${hybrid.failed.length} page(s) could not be cropped automatically — use Manual crop for them` : '', hybrid.review.length ? `${hybrid.review.length} page(s) were cropped with lower confidence — please check them` : ''].filter(Boolean).join('; ');
      await this.dispatch.emit({ type: 'labels.ready', organizationId: job.organizationId, title: `Cropped labels ready: ${labels.length} labels`, body: `${job.fileName} is ready to print${notes ? ` (${notes})` : ''}. Download it in Labels within ${KEEP_DAYS} days.` });
    } catch (e) {
      const msg = (e as Error).message?.slice(0, 300) || 'Could not process this PDF';
      await this.db.labelCropJob.update({ where: { id }, data: { status: 'FAILED', error: /^[A-Z]/.test(msg) ? msg : 'This PDF could not be read. Try downloading it again from the marketplace, or use Manual crop.', finishedAt: new Date() } });
      this.log.warn(`Label crop ${id} failed: ${msg}`);
    } finally {
      // Buyer names and addresses: keep the uploaded original only as long as the job needs it.
      if (job.sourceKey) {
        await this.db.fileBlob.delete({ where: { id: job.sourceKey.slice(3) } }).catch(() => undefined);
        await this.db.labelCropJob.update({ where: { id }, data: { sourceKey: null } });
      }
    }
  }

  private async purge() {
    const old = await this.db.labelCropJob.findMany({ where: { expiresAt: { lt: new Date() } }, select: { id: true, sourceKey: true, outputKey: true }, take: 50 });
    for (const j of old) {
      const ids = [j.sourceKey, j.outputKey].filter((k): k is string => Boolean(k)).map((k) => k.slice(3));
      if (ids.length) await this.db.fileBlob.deleteMany({ where: { id: { in: ids } } });
      await this.db.labelCropJob.delete({ where: { id: j.id } });
    }
  }
}

const safeName = (n: string) => (n || 'labels.pdf').replace(/[^\w.\- ]+/g, '_').slice(0, 120);
