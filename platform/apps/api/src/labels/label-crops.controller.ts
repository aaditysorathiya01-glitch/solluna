import { Body, Controller, Get, Param, Post, Req, Res, UploadedFile as UploadedFileParam, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { CurrentUser, CustomerOnly } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import type { UploadedFile } from '../documents/documents.service';
import { LabelCropsService, MAX_LABEL_PDF_BYTES } from './label-crops.service';

@Controller('label-crops')
@CustomerOnly()
export class LabelCropsController {
  constructor(private readonly crops: LabelCropsService) {}

  @Get() list(@CurrentUser() u: AuthUser) { return this.crops.list(u); }

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_LABEL_PDF_BYTES + 1, files: 1, fields: 5 } }))
  create(@CurrentUser() u: AuthUser, @UploadedFileParam() file: UploadedFile | undefined, @Body() body: unknown) { return this.crops.create(u, file, body); }

  @Get(':id/download')
  async download(@CurrentUser() u: AuthUser, @Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    const { fileName, data } = await this.crops.download(u, id, req.ip);
    res.set({
      'content-type': 'application/pdf', 'content-length': String(data.length), 'content-disposition': `attachment; filename="${fileName}"`,
      'x-content-type-options': 'nosniff', 'cache-control': 'private, no-store', 'content-security-policy': "default-src 'none'; sandbox",
    });
    res.end(data);
  }
}
