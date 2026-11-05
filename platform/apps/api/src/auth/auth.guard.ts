import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../common/prisma.service';
import { ACCESS, Access, IS_PUBLIC } from './decorators';
import type { AuthUser } from './auth.types';

export const SESSION_COOKIE = 'solluna_session';

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

/**
 * Global guard. Every request re-loads the user from the DB, so deactivating an
 * employee or suspending a client takes effect on the very next request.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly jwt: JwtService, private readonly db: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest();
    const bearer = (req.headers.authorization as string | undefined)?.replace(/^Bearer\s+/i, '');
    const token = bearer || readCookie(req.headers.cookie, SESSION_COOKIE);
    if (!token) throw new UnauthorizedException('Not signed in');

    let sub: string;
    try {
      sub = (await this.jwt.verifyAsync<{ sub: string }>(token)).sub;
    } catch {
      throw new UnauthorizedException('Session expired or invalid');
    }
    const user = await this.db.user.findUnique({ where: { id: sub }, include: { organization: true } });
    if (!user || !user.isActive) throw new UnauthorizedException('Account disabled');
    if (user.type === 'CUSTOMER' && (!user.organizationId || user.organization?.isSuspended)) {
      throw new ForbiddenException('Organization suspended');
    }
    const authUser: AuthUser = {
      id: user.id, type: user.type, staffRole: user.staffRole, organizationId: user.organizationId, email: user.email, name: user.name,
    };
    req.user = authUser;

    const access = this.reflector.getAllAndOverride<Access | undefined>(ACCESS, targets);
    if (!access) return true;
    if (access.customer && user.type === 'CUSTOMER') return true;
    if (access.staff && user.type === 'STAFF') {
      if (access.staff === 'ANY' || user.staffRole === 'SUPER_ADMIN' || access.staff.includes(user.staffRole!)) return true;
    }
    throw new ForbiddenException('Not permitted for this account');
  }
}
