import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { StaffRole } from '@prisma/client';

export const IS_PUBLIC = 'isPublic';
export const ALLOW_PENDING_2FA = 'allowPending2fa';
export const ACCESS = 'access';
export type Access = { customer?: boolean; staff?: StaffRole[] | 'ANY' };

/** No authentication required. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Reachable by a super admin who has not yet enrolled 2FA (enrollment, me, logout). */
export const AllowPending2fa = () => SetMetadata(ALLOW_PENDING_2FA, true);
/** Customer users only (tenant-scoped). */
export const CustomerOnly = () => SetMetadata(ACCESS, { customer: true } satisfies Access);
/** Staff users; optionally restricted to roles. SUPER_ADMIN always passes. */
export const StaffOnly = (...roles: StaffRole[]) => SetMetadata(ACCESS, { staff: roles.length ? roles : 'ANY' } satisfies Access);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest().user);
