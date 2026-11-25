import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser, CustomerOnly, StaffOnly } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import { ReportsService } from './reports.service';
import { ReportCycleService } from './report-cycle.service';
import { PlImportService } from './pl-import.service';
import { OrdersPlService } from './orders-pl.service';

const sendXlsx = (res: Response, f: { fileName: string; buf: Buffer }) => {
  res.set({ 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': `attachment; filename="${f.fileName}"`, 'cache-control': 'private, no-store' });
  res.send(f.buf);
};
const sendCsv = (res: Response, f: { fileName: string; csv: string }) => {
  res.set({ 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${f.fileName}"`, 'cache-control': 'private, no-store' });
  res.send(f.csv);
};

/** Client: published reports, product costs, expenses, CA pack. */
@Controller()
@CustomerOnly()
export class ClientReportsController {
  constructor(private readonly reports: ReportsService, private readonly cycle: ReportCycleService, private readonly pl: PlImportService, private readonly opl: OrdersPlService) {}
  /** Monthly cycle: month end → marketplace reports on the 5th → report ready by the 7th. */
  @Get('reports/schedule') schedule(@CurrentUser() u: AuthUser) { return this.cycle.schedule(u.organizationId!); }
  /** SKU-wise profit from Flipkart's P&L report (published months only). */
  @Get('reports/sku-profit') skuProfit(@CurrentUser() u: AuthUser, @Query('period') p: string) { return this.pl.view(u, u.organizationId!, p); }
  @Get('reports/sku-profit.csv') async skuProfitCsv(@CurrentUser() u: AuthUser, @Query('period') p: string, @Res() res: Response) { sendCsv(res, await this.pl.csv(u, u.organizationId!, p)); }

  /** Flipkart order-wise P&L (owner's method): months, the report, Excel, purchase cost per item, SKU → item. */
  @Get('reports/orders-pl/range') oplRange(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) { return this.opl.range(u, u.organizationId!, q); }
  @Get('reports/orders-pl/range.xlsx') async oplRangeXlsx(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>, @Res() res: Response) { sendXlsx(res, await this.opl.rangeXlsx(u, u.organizationId!, q)); }
  @Get('reports/orders-pl/months') oplMonths(@CurrentUser() u: AuthUser) { return this.opl.months(u, u.organizationId!); }
  @Get('reports/orders-pl') oplView(@CurrentUser() u: AuthUser, @Query('period') p: string) { return this.opl.view(u, u.organizationId!, p); }
  @Get('reports/orders-pl.xlsx') async oplXlsx(@CurrentUser() u: AuthUser, @Query('period') p: string, @Res() res: Response) { sendXlsx(res, await this.opl.xlsx(u, u.organizationId!, p)); }
  @Put('reports/orders-pl/cost') oplCost(@CurrentUser() u: AuthUser, @Query('period') p: string, @Body() b: unknown) { return this.opl.setCost(u, u.organizationId!, p, b); }
  @Put('reports/orders-pl/sku-item') oplSku(@CurrentUser() u: AuthUser, @Body() b: unknown) { return this.opl.setSkuItem(u, u.organizationId!, b); }

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
  constructor(private readonly reports: ReportsService, private readonly cycle: ReportCycleService, private readonly pl: PlImportService, private readonly opl: OrdersPlService) {}

  /** Flipkart order-wise P&L: Orders report + Settlement reports (import runs in the background), review, publish. */
  @Get('orders-pl/:orgId/months') oplMonths(@CurrentUser() u: AuthUser, @Param('orgId') o: string) { return this.opl.months(u, o); }
  @Post(':orgId/:period/orders-pl') oplStart(@CurrentUser() u: AuthUser, @Param('orgId') o: string, @Param('period') p: string, @Body() b: unknown) { return this.opl.start(u, o, p, b); }
  @Get(':orgId/:period/orders-pl') oplView(@CurrentUser() u: AuthUser, @Param('orgId') o: string, @Param('period') p: string) { return this.opl.view(u, o, p); }
  @Get(':orgId/:period/orders-pl.xlsx') async oplXlsx(@CurrentUser() u: AuthUser, @Param('orgId') o: string, @Param('period') p: string, @Res() res: Response) { sendXlsx(res, await this.opl.xlsx(u, o, p)); }
  @Post(':orgId/:period/orders-pl/publish') @HttpCode(200) oplPublish(@CurrentUser() u: AuthUser, @Param('orgId') o: string, @Param('period') p: string) { return this.opl.publish(u, o, p); }
  @Put(':orgId/:period/orders-pl/cost') oplCost(@CurrentUser() u: AuthUser, @Param('orgId') o: string, @Param('period') p: string, @Body() b: unknown) { return this.opl.setCost(u, o, p, b); }
  @Put(':orgId/orders-pl/sku-item') oplSku(@CurrentUser() u: AuthUser, @Param('orgId') o: string, @Body() b: unknown) { return this.opl.setSkuItem(u, o, b); }

  /** Flipkart P&L report → SKU profit (import runs in the background), then publish to the client. */
  @Post(':orgId/:period/flipkart-pl') importPl(@CurrentUser() u: AuthUser, @Param('orgId') o: string, @Param('period') p: string, @Body() b: unknown) { return this.pl.start(u, o, p, b); }
  @Get(':orgId/:period/sku-profit') opsSkuProfit(@CurrentUser() u: AuthUser, @Param('orgId') o: string, @Param('period') p: string) { return this.pl.view(u, o, p); }
  @Post(':orgId/:period/sku-profit/publish') @HttpCode(200) publishPl(@CurrentUser() u: AuthUser, @Param('orgId') o: string, @Param('period') p: string) { return this.pl.publish(u, o, p); }

  /** Runs the monthly cycle now (it also runs on its own every 30 minutes). `date` (YYYY-MM-DD) is for testing a given day. */
  @Post('cycle/run') @HttpCode(200) runCycle(@Body() b: { date?: string }) {
    const at = b?.date && /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? new Date(`${b.date}T06:00:00Z`) : new Date();
    return this.cycle.run(at);
  }

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
