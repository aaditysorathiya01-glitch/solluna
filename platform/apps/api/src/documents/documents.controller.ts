import { Body, Controller, Delete, Get, Param, Post, Query, Req, Res, UploadedFile as UploadedFileParam, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { CurrentUser } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import { DocumentsService, MAX_UPLOAD_BYTES, type UploadedFile } from './documents.service';

@Controller('documents')
export class DocumentsController {
  constructor(private readonly docs: DocumentsService) {}

  @Post()
  // In-memory (Nest default without dest). +1 byte so oversize files reach the service and get a clear 413 message.
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES + 1, files: 1, fields: 10 } }))
  upload(@CurrentUser() user: AuthUser, @UploadedFileParam() file: UploadedFile | undefined, @Body() body: unknown) {
    return this.docs.upload(user, file, body);
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('organizationId') orgId?: string, @Query('kind') kind?: string) {
    return this.docs.list(user, orgId, kind);
  }

  @Get(':id/download')
  async download(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    const { doc, data } = await this.docs.download(user, id, req.ip);
    res.set({
      'content-type': doc.mimeType,
      'content-length': String(data.length),
      'content-disposition': `attachment; filename="${doc.fileName}"`,
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
      'content-security-policy': "default-src 'none'; sandbox",
    });
    res.end(data);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.docs.remove(user, id); }
}
