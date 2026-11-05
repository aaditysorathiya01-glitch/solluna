import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/decorators';
import { PrismaService } from './common/prisma.service';
import { SkillsService } from './features/skills.service';
import { RazorpayClient } from './billing/razorpay.client';
import { config } from './common/config';

@Controller('health')
export class HealthController {
  constructor(private readonly db: PrismaService, private readonly skills: SkillsService, private readonly rzp: RazorpayClient) {}

  @Public() @Get()
  async health() {
    await this.db.$queryRaw`SELECT 1`;
    return {
      ok: true,
      skillsLoaded: this.skills.list().length,
      payments: this.rzp.configured ? 'configured' : 'not_configured',
      connectorWebhook: config.connectorWebhookUrl ? 'configured' : 'not_configured',
    };
  }
}
