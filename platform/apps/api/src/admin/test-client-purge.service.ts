import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { parse } from '../common/zod';
import type { AuthUser } from '../auth/auth.types';

/**
 * Deletes a TEST client and every row of its tenant (owner, 12 Nov 2026). Preview environments only, super admin only,
 * and the exact account email must be typed again. Real clients are never deleted this way.
 */
@Injectable()
export class TestClientPurgeService {
  constructor(private readonly db: PrismaService, private readonly audit: AuditService) {}

  async purge(actor: AuthUser, input: unknown) {
    if (process.env.PREVIEW_MODE !== 'true') throw new ForbiddenException('Test clients can only be deleted on the preview environment');
    const { email, confirm } = parse(z.object({ email: z.string().trim().toLowerCase().email(), confirm: z.string().trim().toLowerCase() }), input);
    if (email !== confirm) throw new BadRequestException('Type the same email in both boxes to confirm');
    const user = await this.db.user.findUnique({ where: { email } });
    if (!user || user.type !== 'CUSTOMER' || !user.organizationId) throw new NotFoundException('No client account with this email');
    const orgId = user.organizationId;
    const users = (await this.db.user.findMany({ where: { organizationId: orgId }, select: { id: true } })).map((u) => u.id);

    // Every model with an organizationId column, plus user-owned rows; FK order is resolved by retrying in passes.
    const client = this.db as unknown as Record<string, { deleteMany: (a: unknown) => Promise<{ count: number }> }>;
    const lc = (n: string) => n.charAt(0).toLowerCase() + n.slice(1);
    const steps: { model: string; where: unknown }[] = [];
    for (const m of Prisma.dmmf.datamodel.models) {
      const fields = m.fields.map((f) => f.name);
      if (m.name === 'Organization' || m.name === 'User') continue;
      if (fields.includes('organizationId')) steps.push({ model: lc(m.name), where: { organizationId: orgId } });
      else if (fields.includes('userId') && fields.includes('id')) steps.push({ model: lc(m.name), where: { userId: { in: users } } });
    }
    steps.push({ model: 'auditLog', where: { actorId: { in: users } } });
    steps.push({ model: 'user', where: { organizationId: orgId } });

    let pending = steps; let removed = 0;
    for (let pass = 0; pass < 8 && pending.length; pass++) {
      const next: typeof steps = [];
      for (const s of pending) {
        try { removed += (await client[s.model].deleteMany({ where: s.where })).count; } catch { next.push(s); }
      }
      if (next.length === pending.length && pass > 0) break;
      pending = next;
    }
    if (pending.length) throw new BadRequestException(`Could not delete: ${pending.map((p) => p.model).join(', ')}`);
    await this.db.organization.delete({ where: { id: orgId } });
    await this.audit.log({ actor, action: 'client.test_deleted', entity: 'Organization', entityId: orgId, after: { email, rows: removed } });
    return { deleted: true, email, rows: removed };
  }
}
