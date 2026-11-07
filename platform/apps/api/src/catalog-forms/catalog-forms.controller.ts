import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { CurrentUser, CustomerOnly } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import { CatalogFormsService } from './catalog-forms.service';
import { ProductLookupService } from './product-lookup.service';

@Controller('catalog-forms')
@CustomerOnly()
export class CatalogFormsController {
  constructor(private readonly forms: CatalogFormsService, private readonly lookup: ProductLookupService) {}
  @Get() async list(@CurrentUser() u: AuthUser) { return { ...(await this.forms.list(u)), lookupAvailable: this.lookup.available }; }
  @Post('lookup') startLookup(@CurrentUser() u: AuthUser, @Body() body: unknown) { return this.lookup.start(u, body); }
  @Get('lookup/:id') getLookup(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.lookup.get(u, id); }
  @Post() submit(@CurrentUser() u: AuthUser, @Body() body: unknown) { return this.forms.submit(u, body); }
  @Post('templates') saveTemplate(@CurrentUser() u: AuthUser, @Body() body: unknown) { return this.forms.saveTemplate(u, body); }
  @Delete('templates/:id') @HttpCode(200) deleteTemplate(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.forms.deleteTemplate(u, id); }
}
