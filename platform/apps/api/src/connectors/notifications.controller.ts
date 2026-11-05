import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { CurrentUser } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly db: PrismaService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 50 });
  }

  @Post(':id/read') @HttpCode(200)
  async read(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const r = await this.db.notification.updateMany({ where: { id, userId: user.id }, data: { readAt: new Date() } });
    return { updated: r.count };
  }
}
