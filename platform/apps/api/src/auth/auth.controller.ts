import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { AllowPending2fa, CurrentUser, CustomerOnly, Public, StaffOnly } from './decorators';
import { SESSION_COOKIE } from './auth.guard';
import { config } from '../common/config';
import type { AuthUser } from './auth.types';

/** Brute-force protection on register/login/recovery, per IP. */
const AUTH_LIMIT = Number(process.env.AUTH_RATE_LIMIT_PER_MIN ?? 5);
const LIMIT = { default: { limit: AUTH_LIMIT, ttl: 60_000 } };

function setSession(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, secure: config.cookieSecure, sameSite: 'lax', path: '/', maxAge: 12 * 3600 * 1000 });
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public() @Post('register') @Throttle(LIMIT)
  async register(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.register(body, req.ip);
    if ('codeRequired' in r) { res.status(202); return r; } // email code sent; account not created yet
    setSession(res, r.token);
    return r;
  }

  @Public() @Post('login') @HttpCode(200) @Throttle(LIMIT)
  async login(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { token } = await this.auth.login(body, req.ip);
    setSession(res, token);
    return { token };
  }

  @Post('logout') @HttpCode(200) @AllowPending2fa()
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }

  @Get('me') @AllowPending2fa()
  me(@CurrentUser() user: AuthUser) { return this.auth.me(user); }

  @Public() @Post('password/forgot') @HttpCode(200) @Throttle(LIMIT)
  forgot(@Body() body: unknown, @Req() req: Request) { return this.auth.forgotPassword(body, req.ip); }

  @Public() @Post('password/reset') @HttpCode(200) @Throttle(LIMIT)
  reset(@Body() body: unknown, @Req() req: Request) { return this.auth.resetPassword(body, req.ip); }

  @Post('password/change') @HttpCode(200) @Throttle(LIMIT) @AllowPending2fa()
  async change(@CurrentUser() user: AuthUser, @Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const { token } = await this.auth.changePassword(user, body);
    setSession(res, token);
    return { ok: true, token };
  }

  @Post('email/verify-request') @HttpCode(200) @Throttle(LIMIT)
  verifyRequest(@CurrentUser() user: AuthUser) { return this.auth.requestVerification(user); }

  @Public() @Post('email/verify') @HttpCode(200) @Throttle(LIMIT)
  verify(@Body() body: unknown) { return this.auth.verifyEmail(body); }

  @Post('2fa/setup') @HttpCode(200) @AllowPending2fa()
  setup2fa(@CurrentUser() user: AuthUser) { return this.auth.setup2fa(user); }

  @Post('2fa/enable') @HttpCode(200) @Throttle(LIMIT) @AllowPending2fa()
  enable2fa(@CurrentUser() user: AuthUser, @Body() body: unknown) { return this.auth.enable2fa(user, body); }

  @Post('2fa/disable') @HttpCode(200) @Throttle(LIMIT)
  disable2fa(@CurrentUser() user: AuthUser, @Body() body: unknown) { return this.auth.disable2fa(user, body); }

  @Patch('profile')
  profile(@CurrentUser() user: AuthUser, @Body() body: unknown) { return this.auth.updateProfile(user, body); }
}

@Controller('account')
@CustomerOnly()
export class AccountController {
  constructor(private readonly auth: AuthService) {}

  @Patch('organization')
  organization(@CurrentUser() user: AuthUser, @Body() body: unknown) { return this.auth.updateOrganization(user, body); }
}

@Controller('admin/users')
@StaffOnly('SUPER_ADMIN')
export class AdminUsersController {
  constructor(private readonly auth: AuthService) {}

  @Post('staff')
  createStaff(@CurrentUser() actor: AuthUser, @Body() body: unknown) { return this.auth.createStaff(actor, body); }

  @Patch(':id/role')
  role(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() body: unknown) { return this.auth.setRole(actor, id, body); }

  @Patch(':id/deactivate')
  deactivate(@CurrentUser() actor: AuthUser, @Param('id') id: string) { return this.auth.setActive(actor, id, false); }

  @Patch(':id/reactivate')
  reactivate(@CurrentUser() actor: AuthUser, @Param('id') id: string) { return this.auth.setActive(actor, id, true); }

  @Post(':id/reset-2fa') @HttpCode(200)
  reset2fa(@CurrentUser() actor: AuthUser, @Param('id') id: string) { return this.auth.reset2fa(actor, id); }
}
