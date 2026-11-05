import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { CurrentUser, Public, StaffOnly } from './decorators';
import { SESSION_COOKIE } from './auth.guard';
import { config } from '../common/config';
import type { AuthUser } from './auth.types';

/** Brute-force protection on register/login, per IP. */
const AUTH_LIMIT = Number(process.env.AUTH_RATE_LIMIT_PER_MIN ?? 5);

function setSession(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, secure: config.cookieSecure, sameSite: 'lax', path: '/', maxAge: 12 * 3600 * 1000 });
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public() @Post('register') @Throttle({ default: { limit: AUTH_LIMIT, ttl: 60_000 } })
  async register(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { token } = await this.auth.register(body, req.ip);
    setSession(res, token);
    return { token };
  }

  @Public() @Post('login') @HttpCode(200) @Throttle({ default: { limit: AUTH_LIMIT, ttl: 60_000 } })
  async login(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { token } = await this.auth.login(body, req.ip);
    setSession(res, token);
    return { token };
  }

  @Post('logout') @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) { return this.auth.me(user); }
}

@Controller('admin/users')
@StaffOnly('SUPER_ADMIN')
export class AdminUsersController {
  constructor(private readonly auth: AuthService) {}

  @Post('staff')
  createStaff(@CurrentUser() actor: AuthUser, @Body() body: unknown) { return this.auth.createStaff(actor, body); }

  @Patch(':id/deactivate')
  deactivate(@CurrentUser() actor: AuthUser, @Param('id') id: string) { return this.auth.setActive(actor, id, false); }

  @Patch(':id/reactivate')
  reactivate(@CurrentUser() actor: AuthUser, @Param('id') id: string) { return this.auth.setActive(actor, id, true); }
}
