import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentUser, Public, StaffOnly } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import { BillingService } from '../billing/billing.service';
import { AdminService } from './admin.service';

@Controller('public')
export class PublicController {
  constructor(private readonly admin: AdminService) {}

  @Public() @Post('contact') @Throttle({ default: { limit: 5, ttl: 60_000 } })
  contact(@Body() body: unknown, @Req() req: Request) { return this.admin.createInquiry(body, req.ip); }
}

@Controller('admin')
@StaffOnly('SUPER_ADMIN', 'OPERATIONS_MANAGER')
export class AdminController {
  constructor(private readonly admin: AdminService, private readonly billing: BillingService) {}

  @Get('overview') overview() { return this.admin.overview(); }
  @Get('client-list') clients() { return this.admin.clients(); }
  @Get('clients/:orgId/detail') client(@CurrentUser() u: AuthUser, @Param('orgId') orgId: string) { return this.admin.client(u, orgId); }
  @Patch('clients/:orgId/suspension') suspend(@CurrentUser() u: AuthUser, @Param('orgId') orgId: string, @Body() body: unknown) { return this.admin.suspend(u, orgId, body); }
  @Get('team') team() { return this.admin.team(); }
  @Get('plans') plans() { return this.admin.plans(); }
  @Get('inquiries') inquiries(@Query('status') status?: string) { return this.admin.inquiries(status); }
  @Patch('inquiries/:id') inquiry(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown) { return this.admin.updateInquiry(u, id, body); }
  @Post('announcements') announce(@CurrentUser() u: AuthUser, @Body() body: unknown) { return this.admin.announce(u, body); }

  @Patch('plans/:code') @StaffOnly('SUPER_ADMIN')
  updatePlan(@CurrentUser() u: AuthUser, @Param('code') code: string, @Body() body: unknown) { return this.admin.updatePlan(u, code, body); }
  @Patch('plans/:code/features/:key') @StaffOnly('SUPER_ADMIN')
  updateFeature(@CurrentUser() u: AuthUser, @Param('code') code: string, @Param('key') key: string, @Body() body: unknown) { return this.admin.updatePlanFeature(u, code, key, body); }
  @Get('audit') @StaffOnly('SUPER_ADMIN')
  audit(@Query('organizationId') organizationId?: string, @Query('action') action?: string, @Query('actorId') actorId?: string, @Query('before') before?: string) { return this.admin.auditLog({ organizationId, action, actorId, before }); }
  @Post('billing/sweep') @HttpCode(200) @StaffOnly('SUPER_ADMIN')
  sweep() { return this.billing.sweep(); }
}

/** Accounts Executive works payments alongside admins. */
@Controller('admin/payments')
@StaffOnly('SUPER_ADMIN', 'OPERATIONS_MANAGER', 'ACCOUNTS_EXECUTIVE')
export class AdminPaymentsController {
  constructor(private readonly admin: AdminService) {}
  @Get() list(@Query('status') status?: string) { return this.admin.payments(status); }
}
