import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';

/**
 * Object storage behind one interface. MVP driver: Postgres (FileBlob) — transactional with the
 * Document row, tenant data stays in one backed-up store, no new infrastructure for 5–6 clients.
 * Swap for an S3/R2 driver when volume grows; callers only see put/get.
 */
@Injectable()
export class StorageService {
  constructor(private readonly db: PrismaService) {}

  async put(data: Buffer, tx: Prisma.TransactionClient = this.db): Promise<string> {
    const blob = await tx.fileBlob.create({ data: { data }, select: { id: true } });
    return `db:${blob.id}`;
  }

  async get(key: string): Promise<Buffer> {
    if (!key.startsWith('db:')) throw new NotFoundException('Unsupported storage key');
    const blob = await this.db.fileBlob.findUnique({ where: { id: key.slice(3) } });
    if (!blob) throw new NotFoundException('File not found');
    return Buffer.from(blob.data);
  }
}
