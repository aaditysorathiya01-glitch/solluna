import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { OrchestratorService } from './orchestrator.service';
import { CurrentUser, CustomerOnly, StaffOnly } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';

@Controller('requests')
@CustomerOnly()
export class RequestsController {
  constructor(private readonly orch: OrchestratorService) {}

  @Post() create(@CurrentUser() u: AuthUser, @Body() body: unknown) { return this.orch.intake(u, body); }
  @Get() list(@CurrentUser() u: AuthUser) { return this.orch.listRequests(u); }
  @Get(':id') get(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.orch.getRequest(u, id); }
}

@Controller('approvals')
@CustomerOnly()
export class ApprovalsController {
  constructor(private readonly orch: OrchestratorService) {}

  @Get() list(@CurrentUser() u: AuthUser) { return this.orch.listApprovals(u); }
  @Post(':id/decision') @HttpCode(200)
  decide(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown) { return this.orch.decideApproval(u, id, body); }
}

@Controller('ops')
@StaffOnly()
export class OpsController {
  constructor(private readonly orch: OrchestratorService) {}

  @Get('tasks') queue(@CurrentUser() u: AuthUser, @Query('status') status?: string) { return this.orch.staffQueue(u, status); }
  @Get('tasks/:id/context') context(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.orch.taskContext(u, id); }
  @Patch('tasks/:id') transition(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown) { return this.orch.transition(u, id, body); }
  @Get('requests/:id') request(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.orch.staffRequest(u, id); }
}
