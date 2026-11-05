import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { BillingService } from './billing.service';
import { CurrentUser, CustomerOnly, Public, StaffOnly } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';

@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @CustomerOnly() @Get()
  summary(@CurrentUser() user: AuthUser) { return this.billing.billingSummary(user); }

  @CustomerOnly() @Patch('profile')
  profile(@CurrentUser() user: AuthUser, @Body() body: unknown) { return this.billing.updateProfile(user, body); }

  @StaffOnly('SUPER_ADMIN', 'ACCOUNTS_EXECUTIVE') @Get('admin/invoices/:id')
  staffInvoice(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.billing.getInvoice(user, id); }

  @CustomerOnly() @Get('invoices/:id')
  invoice(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.billing.getInvoice(user, id); }

  @CustomerOnly() @Post('checkout')
  checkout(@CurrentUser() user: AuthUser, @Body() body: unknown) { return this.billing.checkout(user, body); }

  @CustomerOnly() @Post('verify') @HttpCode(200)
  verify(@CurrentUser() user: AuthUser, @Body() body: unknown) { return this.billing.verifyCheckout(user, body); }

  @Public() @SkipThrottle() @Post('webhook/razorpay') @HttpCode(200)
  webhook(@Req() req: RawBodyRequest<Request>, @Headers('x-razorpay-signature') sig?: string) {
    return this.billing.handleWebhook(req.rawBody, sig);
  }

  @StaffOnly('SUPER_ADMIN', 'ACCOUNTS_EXECUTIVE') @Post('sweep') @HttpCode(200)
  sweep() { return this.billing.sweep(); }
}
