import { BadRequestException, ForbiddenException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { createHash } from 'crypto';
import { z } from 'zod';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { AccessService } from '../common/access.service';
import { parse } from '../common/zod';
import { StorageService } from './storage.service';
import { ALLOWED_DESCRIPTION, detectFileType, safeFileName } from './file-type';
import type { AuthUser } from '../auth/auth.types';

export const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_MB ?? 10) * 1024 * 1024;
export const DOCUMENT_KINDS = [
  'GST_CERT', 'PAN', 'INVOICE', 'BRAND_AUTH', 'STATEMENT', 'REPORT', 'CA_DOCUMENT', 'LABELS', 'LISTING_ASSETS', 'CHAT_ATTACHMENT', 'OTHER',
  // CA pack (ca-documentation-support §3)
  'AMAZON_SETTLEMENT', 'AMAZON_FEE_INVOICE', 'AMAZON_TCS', 'FLIPKART_SETTLEMENT', 'FLIPKART_FEE_INVOICE', 'FLIPKART_TCS',
  // Owner's monthly CA files (10 Nov 2026): Flipkart tax reports and Amazon GST MTR.
  'FLIPKART_GSTR_REPORT', 'FLIPKART_SALES_REPORT', 'FLIPKART_TDS', 'AMAZON_MTR_B2B', 'AMAZON_MTR_B2C', 'FLIPKART_PL_REPORT',
  'PURCHASE_INVOICE', 'EXPENSE_INVOICE', 'BANK_STATEMENT',
] as const;

export interface UploadedFile { originalname: string; buffer: Buffer; size: number }

const UploadSchema = z.object({
  kind: z.enum(DOCUMENT_KINDS).default('OTHER'),
  title: z.string().trim().max(200).optional(),
  visibility: z.enum(['CLIENT', 'INTERNAL']).default('CLIENT'),
  organizationId: z.string().optional(),
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(), // accounting month (CA pack)
});

const PUBLIC_FIELDS = { id: true, organizationId: true, kind: true, title: true, fileName: true, visibility: true, mimeType: true, sizeBytes: true, scanStatus: true, uploadedById: true, messageId: true, periodMonth: true, caStatus: true, createdAt: true } as const;

@Injectable()
export class DocumentsService {
  constructor(
    private readonly db: PrismaService,
    private readonly storage: StorageService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  async upload(user: AuthUser, file: UploadedFile | undefined, input: unknown) {
    if (!file) throw new BadRequestException('Attach a file');
    if (file.size > MAX_UPLOAD_BYTES) throw new PayloadTooLargeException(`Files must be under ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
    const d = parse(UploadSchema, input);
    const orgId = user.type === 'CUSTOMER' ? user.organizationId! : d.organizationId;
    if (!orgId) throw new BadRequestException('organizationId is required');
    await this.access.assertOrg(user, orgId);
    if (user.type === 'CUSTOMER' && d.visibility === 'INTERNAL') throw new ForbiddenException('Only SOLLUNA staff can add internal documents');

    const type = detectFileType(file.buffer, file.originalname);
    if (!type) throw new BadRequestException(`Unsupported or unsafe file. Allowed: ${ALLOWED_DESCRIPTION}. The file's content must match its type.`);
    const fileName = safeFileName(file.originalname, type.ext);
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');

    const doc = await this.db.$transaction(async (tx) => {
      const fileKey = await this.storage.put(file.buffer, tx);
      return tx.document.create({
        data: { organizationId: orgId, kind: d.kind, title: d.title || fileName, fileName, visibility: d.visibility, fileKey, sha256, mimeType: type.mime, sizeBytes: file.size, uploadedById: user.id, periodMonth: d.period ? new Date(`${d.period}-01T00:00:00Z`) : null },
        select: PUBLIC_FIELDS,
      });
    });
    await this.audit.log({ actor: user, action: 'document.upload', entity: 'Document', entityId: doc.id, organizationId: orgId, after: { kind: doc.kind, mime: doc.mimeType, size: doc.sizeBytes, visibility: doc.visibility, sha256 } });
    return doc;
  }

  async list(user: AuthUser, orgIdParam?: string, kind?: string) {
    const orgId = user.type === 'CUSTOMER' ? user.organizationId! : orgIdParam;
    if (!orgId) throw new BadRequestException('organizationId is required');
    await this.access.assertOrg(user, orgId);
    return this.db.document.findMany({
      where: { organizationId: orgId, deletedAt: null, ...(user.type === 'CUSTOMER' ? { visibility: 'CLIENT' } : {}), ...(kind ? { kind } : {}) },
      orderBy: { createdAt: 'desc' },
      select: PUBLIC_FIELDS,
    });
  }

  /** Loads a document the user may see; customers never see INTERNAL documents. */
  async findAccessible(user: AuthUser, id: string) {
    const doc = await this.db.document.findUnique({ where: { id } });
    if (!doc || doc.deletedAt) throw new NotFoundException('Document not found');
    if (!(await this.access.canAccessOrg(user, doc.organizationId))) throw new NotFoundException('Document not found');
    if (user.type === 'CUSTOMER' && doc.visibility !== 'CLIENT') throw new NotFoundException('Document not found');
    return doc;
  }

  async download(user: AuthUser, id: string, ip?: string) {
    const doc = await this.findAccessible(user, id);
    const data = await this.storage.get(doc.fileKey);
    if (createHash('sha256').update(data).digest('hex') !== doc.sha256) throw new NotFoundException('File failed its integrity check');
    // Staff access to client files is a sensitive action (plan §16) — always audited.
    if (user.type === 'STAFF') await this.audit.log({ actor: user, action: 'document.staff_download', entity: 'Document', entityId: doc.id, organizationId: doc.organizationId, ip });
    return { doc, data };
  }

  async remove(user: AuthUser, id: string) {
    const doc = await this.findAccessible(user, id);
    if (doc.messageId) throw new BadRequestException('Chat attachments are part of the conversation record and cannot be deleted');
    if (doc.uploadedById !== user.id && !this.access.seesAllClients(user)) throw new ForbiddenException('Only the uploader can delete this document');
    await this.db.document.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ actor: user, action: 'document.delete', entity: 'Document', entityId: id, organizationId: doc.organizationId });
    return { deleted: true };
  }
}
