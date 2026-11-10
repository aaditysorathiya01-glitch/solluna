import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import { CurrentUser, CustomerOnly, StaffOnly } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import { CatalogService } from './catalog.service';
import { config } from '../common/config';
import { MarketplaceApiService } from '../connectors/marketplace-api.service';

@Controller()
@CustomerOnly()
export class CatalogController {
  constructor(private readonly catalog: CatalogService, private readonly apiKeys: MarketplaceApiService) {}

  /** Client's own official API keys: save (tested at once), re-test, remove. Never returned. */
  @Put('marketplaces/:mp/api-keys') saveApiKeys(@CurrentUser() u: AuthUser, @Param('mp') mp: string, @Body() body: unknown) { return this.apiKeys.save(u, mp, body); }
  @Post('marketplaces/:mp/api-keys/test') @HttpCode(200) testApiKeys(@CurrentUser() u: AuthUser, @Param('mp') mp: string) { return this.apiKeys.test(u.organizationId!, (mp === 'AMAZON' ? 'AMAZON' : 'FLIPKART')); }
  @Delete('marketplaces/:mp/api-keys') removeApiKeys(@CurrentUser() u: AuthUser, @Param('mp') mp: string) { return this.apiKeys.remove(u, mp); }

  @Get('onboarding') onboarding(@CurrentUser() u: AuthUser) { return this.catalog.onboarding(u); }
  /** The SOLLUNA user the client adds in Seller Central / Seller Hub. */
  @Get('marketplaces/access-user') accessUser() { return config.opsUser; }
  @Get('marketplaces') marketplaces(@CurrentUser() u: AuthUser) { return this.catalog.marketplaces(u); }
  @Put('marketplaces/:mp') saveMarketplace(@CurrentUser() u: AuthUser, @Param('mp') mp: string, @Body() body: unknown) { return this.catalog.saveMarketplace(u, mp, body); }
  @Get('products') products(@CurrentUser() u: AuthUser) { return this.catalog.products(u); }
  @Post('products') createProduct(@CurrentUser() u: AuthUser, @Body() body: unknown) { return this.catalog.createProduct(u, body); }
  @Patch('products/:id') updateProduct(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown) { return this.catalog.updateProduct(u, id, body); }
  @Get('listings') listings(@CurrentUser() u: AuthUser) { return this.catalog.listings(u); }
  @Post('listings') submitListing(@CurrentUser() u: AuthUser, @Body() body: unknown) { return this.catalog.submitListing(u, body); }
  @Get('mappings') mappings(@CurrentUser() u: AuthUser) { return this.catalog.mappings(u); }
  @Post('mappings') submitMapping(@CurrentUser() u: AuthUser, @Body() body: unknown) { return this.catalog.submitMapping(u, body); }
}

@Controller('ops')
@StaffOnly()
export class OpsCatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('clients/:orgId/onboarding') onboarding(@CurrentUser() u: AuthUser, @Param('orgId') orgId: string) { return this.catalog.onboarding(u, orgId); }
  @Get('clients/:orgId/marketplaces') marketplaces(@CurrentUser() u: AuthUser, @Param('orgId') orgId: string) { return this.catalog.marketplaces(u, orgId); }
  @Patch('clients/:orgId/marketplaces/:mp')
  @StaffOnly('OPERATIONS_MANAGER', 'LISTING_EXECUTIVE')
  verify(@CurrentUser() u: AuthUser, @Param('orgId') orgId: string, @Param('mp') mp: string, @Body() body: unknown) { return this.catalog.verifyMarketplace(u, orgId, mp, body); }
  @Get('clients/:orgId/products') products(@CurrentUser() u: AuthUser, @Param('orgId') orgId: string) { return this.catalog.products(u, orgId); }
  @Get('clients/:orgId/listings') listings(@CurrentUser() u: AuthUser, @Param('orgId') orgId: string) { return this.catalog.listings(u, orgId); }
  @Get('clients/:orgId/mappings') mappings(@CurrentUser() u: AuthUser, @Param('orgId') orgId: string) { return this.catalog.mappings(u, orgId); }
  @Patch('listings/:id')
  @StaffOnly('OPERATIONS_MANAGER', 'LISTING_EXECUTIVE')
  updateListing(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown) { return this.catalog.updateListing(u, id, body); }
  @Patch('mappings/:id')
  @StaffOnly('OPERATIONS_MANAGER', 'LISTING_EXECUTIVE')
  updateMapping(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown) { return this.catalog.updateMapping(u, id, body); }
}
