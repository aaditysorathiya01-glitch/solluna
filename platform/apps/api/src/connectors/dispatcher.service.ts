import { Injectable, Logger } from '@nestjs/common';
import { createHmac } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { config } from '../common/config';

export type EventType =
  | 'request.created' | 'request.status_changed' | 'task.status_changed' | 'approval.requested' | 'approval.decided'
  | 'subscription.activated' | 'payment.failed' | 'subscription.renewal_reminder' | 'subscription.grace_period' | 'subscription.past_due';

export interface PlatformEvent {
  type: EventType;
  organizationId: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/**
 * Connector-first delivery. Every event:
 *  1. is stored as an in-app Notification for each active user of the client org, and
 *  2. if CONNECTOR_WEBHOOK_URL is set, is POSTed (HMAC-signed) to that URL — intended for the
 *     existing Zapier connector (Catch Hook → Gmail / Google Sheets), so no new email/SMS
 *     provider is needed for the MVP.
 * Connector failures never break the business transaction; they are logged and reported.
 */
@Injectable()
export class DispatcherService {
  private readonly log = new Logger('Connectors');
  constructor(private readonly db: PrismaService) {}

  async emit(e: PlatformEvent): Promise<{ inApp: number; webhook: 'sent' | 'failed' | 'not_configured' }> {
    const users = await this.db.user.findMany({ where: { organizationId: e.organizationId, isActive: true }, select: { id: true } });
    await this.db.notification.createMany({
      data: users.map((u) => ({ organizationId: e.organizationId, userId: u.id, type: e.type, title: e.title, body: e.body })),
    });
    return { inApp: users.length, webhook: await this.sendWebhook(e) };
  }

  private async sendWebhook(e: PlatformEvent): Promise<'sent' | 'failed' | 'not_configured'> {
    if (!config.connectorWebhookUrl) return 'not_configured';
    const org = await this.db.organization.findUnique({ where: { id: e.organizationId }, select: { legalName: true, brandName: true, contactEmail: true } });
    const body = JSON.stringify({ ...e, organization: org, sentAt: new Date().toISOString() });
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (config.connectorWebhookSecret) headers['x-solluna-signature'] = createHmac('sha256', config.connectorWebhookSecret).update(body).digest('hex');
    try {
      const r = await fetch(config.connectorWebhookUrl, { method: 'POST', headers, body, signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return 'sent';
    } catch (err) {
      this.log.warn(`Webhook delivery failed for ${e.type}: ${(err as Error).message}`);
      return 'failed';
    }
  }
}
