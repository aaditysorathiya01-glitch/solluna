import { Controller, Get, Param } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { CurrentUser, CustomerOnly, Public, StaffOnly } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import { EntitlementsService } from './entitlements.service';
import { SkillsService } from './skills.service';
import { FEATURES } from '../../../../packages/permissions/src/features';

@Controller()
export class FeaturesController {
  constructor(private readonly db: PrismaService, private readonly ent: EntitlementsService, private readonly skills: SkillsService) {}

  /** Public pricing — read from the DB so admin edits to limits show up without a deploy. */
  @Public() @Get('plans')
  async plans() {
    const plans = await this.db.plan.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' }, include: { features: true } });
    return plans.map((p) => ({
      code: p.code, name: p.name, pricePaise: p.pricePaise, interval: p.interval,
      features: p.features
        .filter((f) => f.featureKey in FEATURES)
        .map((f) => ({ key: f.featureKey, label: FEATURES[f.featureKey as keyof typeof FEATURES].label, section: FEATURES[f.featureKey as keyof typeof FEATURES].section, enabled: f.enabled, limit: f.limitValue, meta: f.meta })),
    }));
  }

  @CustomerOnly() @Get('features')
  catalog(@CurrentUser() user: AuthUser) { return this.ent.catalog(user.organizationId!); }

  @StaffOnly() @Get('skills')
  listSkills() { return this.skills.list(); }

  @StaffOnly() @Get('skills/:name')
  skill(@Param('name') name: string) { return this.skills.get(name); }
}
