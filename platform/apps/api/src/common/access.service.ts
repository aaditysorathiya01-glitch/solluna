import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { ROLE_FEATURES } from '../../../../packages/permissions/src/roles';
import type { AuthUser } from '../auth/auth.types';

const ALL_CLIENTS = ['SUPER_ADMIN', 'OPERATIONS_MANAGER'];

/**
 * Who may see a client's conversation and documents (plan §6):
 *  - customers: only their own organization;
 *  - SUPER_ADMIN / OPERATIONS_MANAGER: every client;
 *  - other staff: clients they are assigned to as manager, or clients with open work in their role.
 */
@Injectable()
export class AccessService {
  constructor(private readonly db: PrismaService) {}

  seesAllClients(user: AuthUser) { return user.type === 'STAFF' && ALL_CLIENTS.includes(user.staffRole!); }

  async canAccessOrg(user: AuthUser, orgId: string): Promise<boolean> {
    if (user.type === 'CUSTOMER') return user.organizationId === orgId;
    if (this.seesAllClients(user)) return true;
    const assigned = await this.db.managerAssignment.findFirst({ where: { organizationId: orgId, managerId: user.id, endedAt: null } });
    if (assigned) return true;
    const features = ROLE_FEATURES[user.staffRole!];
    if (features === 'ALL') return true;
    return Boolean(await this.db.task.findFirst({ where: { organizationId: orgId, featureKey: { in: features } }, select: { id: true } }));
  }

  async assertOrg(user: AuthUser, orgId: string) {
    if (!(await this.canAccessOrg(user, orgId))) throw new ForbiddenException('No access to this client');
  }

  /** Organization ids a staff user can see (null = all). */
  async staffOrgIds(user: AuthUser): Promise<string[] | null> {
    if (this.seesAllClients(user)) return null;
    const assigned = await this.db.managerAssignment.findMany({ where: { managerId: user.id, endedAt: null }, select: { organizationId: true } });
    const features = ROLE_FEATURES[user.staffRole!];
    const viaTasks = features === 'ALL' ? [] : await this.db.task.findMany({ where: { featureKey: { in: features } }, select: { organizationId: true }, distinct: ['organizationId'] });
    return [...new Set([...assigned, ...viaTasks].map((x) => x.organizationId))];
  }
}
