import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, CustomerOnly, StaffOnly } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import { TicketsService } from './tickets.service';

@Controller('tickets')
@CustomerOnly()
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Post() create(@CurrentUser() u: AuthUser, @Body() body: unknown) { return this.tickets.create(u, body); }
  @Get() list(@CurrentUser() u: AuthUser) { return this.tickets.listForClient(u); }
  @Get(':id') get(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.tickets.get(u, id); }
  @Post(':id/comments') comment(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown) { return this.tickets.comment(u, id, body); }
  @Post(':id/action') @HttpCode(200) action(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown) { return this.tickets.clientAction(u, id, body); }
}

@Controller('ops/tickets')
@StaffOnly()
export class OpsTicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Get() queue(@CurrentUser() u: AuthUser, @Query('status') status?: string) { return this.tickets.staffQueue(u, status); }
  @Get(':id') get(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.tickets.get(u, id); }
  @Patch(':id') update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown) { return this.tickets.update(u, id, body); }
  @Post(':id/comments') comment(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown) { return this.tickets.comment(u, id, body); }
}
