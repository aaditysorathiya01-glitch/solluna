import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req, Res, UploadedFile as UploadedFileParam, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { CurrentUser, CustomerOnly, StaffOnly } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import { MAX_UPLOAD_BYTES, type UploadedFile } from '../documents/documents.service';
import { FulfilmentService } from './fulfilment.service';

function sendPdf(res: Response, doc: { mimeType: string; fileName: string }, data: Buffer) {
  res.set({
    'content-type': doc.mimeType, 'content-length': String(data.length), 'content-disposition': `attachment; filename="${doc.fileName}"`,
    'x-content-type-options': 'nosniff', 'cache-control': 'private, no-store', 'content-security-policy': "default-src 'none'; sandbox",
  });
  res.end(data);
}

@Controller()
@CustomerOnly()
export class FulfilmentController {
  constructor(private readonly f: FulfilmentService) {}

  @Get('labels') labels(@CurrentUser() u: AuthUser) { return this.f.labelJobs(u); }
  @Get('labels/:id/notes') notes(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.f.batchNotes(u, id); }
  @Get('labels/:id/download')
  async download(@CurrentUser() u: AuthUser, @Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    const { doc, data } = await this.f.downloadLabels(u, id, req.ip);
    sendPdf(res, doc, data);
  }

  @Get('thank-you') templates(@CurrentUser() u: AuthUser) { return this.f.templates(u); }
  @Post('thank-you') create(@CurrentUser() u: AuthUser, @Body() body: unknown) { return this.f.saveTemplate(u, undefined, null, body); }
  @Patch('thank-you/:id') update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown) { return this.f.saveTemplate(u, undefined, id, body); }
  @Post('thank-you/:id/decision') @HttpCode(200) decide(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown) { return this.f.decideTemplate(u, id, body); }

  @Get('inventory') inventory(@CurrentUser() u: AuthUser) { return this.f.inventory(u); }
  @Post('inventory/:id/acknowledge') @HttpCode(200) ack(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.f.acknowledge(u, id); }
}

@Controller('ops')
@StaffOnly()
export class OpsFulfilmentController {
  constructor(private readonly f: FulfilmentService) {}

  @Get('clients/:orgId/labels') labels(@CurrentUser() u: AuthUser, @Param('orgId') orgId: string) { return this.f.labelJobs(u, orgId); }
  @Post('clients/:orgId/labels')
  @StaffOnly('OPERATIONS_MANAGER', 'LISTING_EXECUTIVE', 'SUPPORT_EXECUTIVE')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES + 1, files: 1, fields: 10 } }))
  upload(@CurrentUser() u: AuthUser, @Param('orgId') orgId: string, @UploadedFileParam() file: UploadedFile | undefined, @Body() body: unknown) { return this.f.uploadLabels(u, orgId, file, body); }
  @Get('labels/:id/notes') notes(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.f.batchNotes(u, id); }
  @Get('labels/:id/download')
  async download(@CurrentUser() u: AuthUser, @Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    const { doc, data } = await this.f.downloadLabels(u, id, req.ip);
    sendPdf(res, doc, data);
  }

  @Get('clients/:orgId/thank-you') templates(@CurrentUser() u: AuthUser, @Param('orgId') orgId: string) { return this.f.templates(u, orgId); }
  @Post('clients/:orgId/thank-you') create(@CurrentUser() u: AuthUser, @Param('orgId') orgId: string, @Body() body: unknown) { return this.f.saveTemplate(u, orgId, null, body); }
  @Patch('clients/:orgId/thank-you/:id') update(@CurrentUser() u: AuthUser, @Param('orgId') orgId: string, @Param('id') id: string, @Body() body: unknown) { return this.f.saveTemplate(u, orgId, id, body); }
  @Post('thank-you/:id/submit') @HttpCode(200) submit(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.f.submitTemplate(u, id); }

  @Get('clients/:orgId/inventory') inventory(@CurrentUser() u: AuthUser, @Param('orgId') orgId: string) { return this.f.inventory(u, orgId); }
  @Post('clients/:orgId/inventory')
  @StaffOnly('OPERATIONS_MANAGER', 'ADS_MANAGER', 'LISTING_EXECUTIVE')
  record(@CurrentUser() u: AuthUser, @Param('orgId') orgId: string, @Body() body: unknown) { return this.f.recordInventory(u, orgId, body); }
}
