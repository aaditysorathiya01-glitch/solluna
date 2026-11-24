import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { CurrentUser } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import { IN_APP_HIDDEN_TYPES } from './dispatcher.service';

/** Hides older rows of what now lives only in Manager Chat / Listings & Mapping (owner, 24 Nov 2026). */
const visible = (userId: string) => ({
  userId,
  type: { notIn: IN_APP_HIDDEN_TYPES },
  NOT: { AND: [{ type: { in: ['request.created', 'request.status_changed'] } }, { OR: [{ title: { contains: 'mapping', mode: 'insensitive' as const } }, { title: { contains: 'listing', mode: 'insensitive' as const } }] }] },
});

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly db: PrismaService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.db.notification.findMany({ where: visible(user.id), orderBy: { createdAt: 'desc' }, take: 50 });
  }

  @Get('unread-count')
  async unread(@CurrentUser() user: AuthUser) {
    return { count: await this.db.notification.count({ where: { ...visible(user.id), readAt: null } }) };
  }

  @Post('read-all') @HttpCode(200)
  async readAll(@CurrentUser() user: AuthUser) {
    const r = await this.db.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
    return { updated: r.count };
  }

  @Post(':id/read') @HttpCode(200)
  async read(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const r = await this.db.notification.updateMany({ where: { id, userId: user.id }, data: { readAt: new Date() } });
    return { updated: r.count };
  }
}
