import { Injectable, Logger } from '@nestjs/common';
import { createHmac } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { config } from '../common/config';

export type EventType =
  | 'request.created' | 'request.status_changed' | 'task.status_changed' | 'approval.requested' | 'approval.decided'
  | 'subscription.activated' | 'payment.failed' | 'chat.message' | 'report.published' | 'report.preparing' | 'subscription.renewal_reminder' | 'subscription.grace_period' | 'subscription.past_due'
  | 'subscription.cancel_scheduled' | 'subscription.expired' | 'ticket.created' | 'ticket.status_changed' | 'ticket.reply' | 'listing.status_changed' | 'mapping.updated'
  | 'labels.ready' | 'stock.alert' | 'thank_you.review' | 'thank_you.decided' | 'marketplace.status_changed' | 'announcement' | 'account.suspended' | 'manager.pending';

/** Events addressed to one person by email (no organization), e.g. password reset links. */
export interface DirectEvent { type: 'auth.password_reset' | 'auth.verify_email' | 'auth.password_changed' | 'auth.login_code' | 'auth.signup_code'; to: string; name: string; title: string; body: string; link?: string }

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

  /** Email-only delivery through the connector webhook. Returns whether a connector accepted it. */
  async direct(e: DirectEvent): Promise<'sent' | 'failed' | 'not_configured'> {
    if (config.resendApiKey) return this.resend(e);
    return this.post({ ...e, sentAt: new Date().toISOString() }, e.type);
  }

  /** Direct transactional email through Resend (sender domain verified in Cloudflare DNS). */
  private async resend(e: DirectEvent): Promise<'sent' | 'failed'> {
    try {
      const r = await fetch(`${config.resendApiUrl}/emails`, {
        method: 'POST', signal: AbortSignal.timeout(10_000),
        headers: { authorization: `Bearer ${config.resendApiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: config.mailFrom, to: [e.to], subject: e.title, text: `Hi ${e.name},\n\n${e.body}\n\n— SOLLUNA` }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
      return 'sent';
    } catch (err) {
      this.log.warn(`Email delivery failed for ${e.type}: ${(err as Error).message}`);
      return 'failed';
    }
  }

  /** In-app notifications for SOLLUNA staff (admin alerts, new tickets, new registrations, inquiries). */
  async notifyStaff(opts: { userIds?: string[]; roles?: string[]; type: string; title: string; body: string; organizationId?: string }) {
    const roleUsers = opts.roles?.length
      ? await this.db.user.findMany({ where: { type: 'STAFF', isActive: true, staffRole: { in: opts.roles as never } }, select: { id: true } })
      : [];
    const ids = [...new Set([...(opts.userIds ?? []), ...roleUsers.map((u) => u.id)])];
    if (!ids.length) return 0;
    await this.db.notification.createMany({ data: ids.map((userId) => ({ userId, organizationId: opts.organizationId ?? null, type: opts.type, title: opts.title, body: opts.body })) });
    return ids.length;
  }

  private async sendWebhook(e: PlatformEvent): Promise<'sent' | 'failed' | 'not_configured'> {
    if (!config.connectorWebhookUrl) return 'not_configured';
    const org = await this.db.organization.findUnique({ where: { id: e.organizationId }, select: { legalName: true, brandName: true, contactEmail: true } });
    return this.post({ ...e, organization: org, sentAt: new Date().toISOString() }, e.type);
  }

  private async post(payload: Record<string, unknown>, type: string): Promise<'sent' | 'failed' | 'not_configured'> {
    if (!config.connectorWebhookUrl) return 'not_configured';
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (config.connectorWebhookSecret) headers['x-solluna-signature'] = createHmac('sha256', config.connectorWebhookSecret).update(body).digest('hex');
    try {
      const r = await fetch(config.connectorWebhookUrl, { method: 'POST', headers, body, signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return 'sent';
    } catch (err) {
      this.log.warn(`Webhook delivery failed for ${type}: ${(err as Error).message}`);
      return 'failed';
    }
  }
}
