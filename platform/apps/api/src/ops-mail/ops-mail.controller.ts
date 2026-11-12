import { Body, Controller, Get, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, Public, StaffOnly } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import { OpsMailService } from './ops-mail.service';

@Controller('ops-mail')
export class OpsMailInboundController {
  constructor(private readonly mail: OpsMailService) {}
  /** Called only by SOLLUNA's Cloudflare Email Worker (shared secret header). */
  @Public() @Post('inbound') @HttpCode(200) @Throttle({ default: { limit: 60, ttl: 60_000 } })
  inbound(@Headers('x-ops-mail-secret') secret: string | undefined, @Body() body: unknown) { return this.mail.inbound(secret, body); }
}

@Controller('ops/ops-mail')
@StaffOnly()
export class OpsMailController {
  constructor(private readonly mail: OpsMailService) {}
  @Get() list() { return this.mail.list(); }
  @Post(':id/otp') @HttpCode(200) otp(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.mail.takeOtp(u, id); }
  @Get(':id') read(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.mail.read(u, id); }
}
