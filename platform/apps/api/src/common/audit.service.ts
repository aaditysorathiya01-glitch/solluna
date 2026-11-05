import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import type { AuthUser } from '../auth/auth.types';

@Injectable()
export class AuditService {
  constructor(private readonly db: PrismaService) {}

  log(e: {
    actor?: AuthUser | null; action: string; entity: string; entityId?: string; organizationId?: string | null;
    before?: unknown; after?: unknown; ip?: string;
  }, tx: Prisma.TransactionClient = this.db) {
    return tx.auditLog.create({
      data: {
        actorId: e.actor?.id ?? null,
        actorType: e.actor ? e.actor.type : 'SYSTEM',
        organizationId: e.organizationId ?? e.actor?.organizationId ?? null,
        action: e.action,
        entity: e.entity,
        entityId: e.entityId,
        before: (e.before ?? undefined) as Prisma.InputJsonValue | undefined,
        after: (e.after ?? undefined) as Prisma.InputJsonValue | undefined,
        ip: e.ip,
      },
    });
  }
}
