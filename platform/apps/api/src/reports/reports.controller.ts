import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser, CustomerOnly, StaffOnly } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import { ReportsService } from './reports.service';

const sendCsv = (res: Response, f: { fileName: string; csv: string }) => {
  res.set({ 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${f.fileName}"`, 'cache-control': 'private, no-store' });
  res.send(f.csv);
};

/** Client: published reports, product costs, expenses, CA pack. */
@Controller()
@CustomerOnly()
export class ClientReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('reports') list(@CurrentUser() u: AuthUser) { return this.reports.list(u, u.organizationId!); }
  @Get('reports/:id') get(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.reports.get(u, id); }
  @Get('reports/:id/export.csv') async csv(@CurrentUser() u: AuthUser, @Param('id') id: string, @Res() res: Response) { sendCsv(res, await this.reports.exportCsv(u, id)); }

  @Get('costs') costs(@CurrentUser() u: AuthUser) { return this.reports.costs(u, u.organizationId!); }
  @Post('costs') addCost(@CurrentUser() u: AuthUser, @Body() b: unknown) { return this.reports.addCost(u, u.organizationId!, b); }

  @Get('expenses') expenses(@CurrentUser() u: AuthUser, @Query('period') period: string) { return this.reports.listExpenses(u, u.organizationId!, period); }
  @Post('expenses') addExpense(@CurrentUser() u: AuthUser, @Body() b: unknown) { return this.reports.addExpense(u, u.organizationId!, b); }
  @Delete('expenses/:id') delExpense(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.reports.deleteExpense(u, u.organizationId!, id); }
  @Post('expenses/confirm') @HttpCode(200) confirm(@CurrentUser() u: AuthUser, @Body() b: { period: string; confirmed?: boolean }) { return this.reports.confirmExpenses(u, b?.period, b?.confirmed !== false); }

  @Get('ca-pack') caPack(@CurrentUser() u: AuthUser, @Query('period') period: string) { return this.reports.caPack(u, u.organizationId!, period); }
}

/** Staff (accounts / operations): monthly inputs, generate → review → publish. */
@Controller('ops/reports')
@StaffOnly('ACCOUNTS_EXECUTIVE', 'OPERATIONS_MANAGER')
export class OpsReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('clients') clients(@CurrentUser() u: AuthUser) { return this.reports.reportingClients(u); }
  @Get(':orgId/:period') workbench(@CurrentUser() u: AuthUser, @Param('orgId') o: string, @Param('period') p: string) { return this.reports.workbench(u, o, p); }
  @Put(':orgId/:period/marketplaces/:mp') month(@CurrentUser() u: AuthUser, @Param('orgId') o: string, @Param('period') p: string, @Param('mp') mp: string, @Body() b: unknown) { return this.reports.upsertMonth(u, o, p, mp, b); }
  @Put(':orgId/:period/marketplaces/:mp/sku-lines') sku(@CurrentUser() u: AuthUser, @Param('orgId') o: string, @Param('period') p: string, @Param('mp') mp: string, @Body() b: unknown) { return this.reports.replaceSkuLines(u, o, p, mp, b); }
  @Post(':orgId/costs') cost(@CurrentUser() u: AuthUser, @Param('orgId') o: string, @Body() b: unknown) { return this.reports.addCost(u, o, b); }
  @Get(':orgId/:period/ca-pack') caPack(@CurrentUser() u: AuthUser, @Param('orgId') o: string, @Param('period') p: string) { return this.reports.caPack(u, o, p); }
  @Post(':orgId/:period/generate') generate(@CurrentUser() u: AuthUser, @Param('orgId') o: string, @Param('period') p: string, @Body() b: unknown) { return this.reports.generate(u, o, p, b); }
  @Post('drafts/:id/publish') @HttpCode(200) publish(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.reports.publish(u, id); }
  @Get('view/:id') get(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.reports.get(u, id); }
  @Get('view/:id/export.csv') async csv(@CurrentUser() u: AuthUser, @Param('id') id: string, @Res() res: Response) { sendCsv(res, await this.reports.exportCsv(u, id)); }
}

@Controller('ops/documents')
@StaffOnly()
export class OpsDocumentsCaController {
  constructor(private readonly reports: ReportsService) {}
  @Patch(':id/ca') setCa(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: unknown) { return this.reports.setDocumentCa(u, id, b); }
}
