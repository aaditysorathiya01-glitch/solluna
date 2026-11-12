import { ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { decrypt, encrypt } from '../common/crypto';
import type { AuthUser } from '../auth/auth.types';
import { classify, findOtp, parseMail } from './mime';

const OTP_TTL_MS = 10 * 60_000;
const KEEP_DAYS = 30;

/**
 * SOLLUNA ops mailbox (ops@solluna.co.in). Cloudflare Email Routing hands each message to a small Worker, which posts the
 * raw message here with a shared secret (and also forwards a copy to the ops Gmail). OTPs are stored encrypted for 10 minutes,
 * deleted when staff read them, and never reach the model (CLAUDE.md rule 6). Bodies are encrypted and kept 30 days.
 */
@Injectable()
export class OpsMailService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  constructor(private readonly db: PrismaService, private readonly audit: AuditService) {}

  onModuleInit() { this.timer = setInterval(() => this.sweep().catch((e) => Logger.error(e, 'OpsMail')), 60_000); this.timer.unref(); }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private checkSecret(given: string | undefined) {
    const want = process.env.OPS_MAIL_INBOUND_SECRET;
    if (!want || want.length < 24) throw new UnauthorizedException('Ops mail inbound is not configured');
    const a = createHash('sha256').update(given ?? '').digest(); const b = createHash('sha256').update(want).digest();
    if (!timingSafeEqual(a, b)) throw new UnauthorizedException('Bad secret');
  }

  async inbound(secret: string | undefined, body: unknown) {
    this.checkSecret(secret);
    const raw = typeof (body as { raw?: unknown })?.raw === 'string' ? (body as { raw: string }).raw : '';
    if (!raw) return { stored: false };
    const m = parseMail(raw.slice(0, 2_000_000));
    const c = classify(m);
    const otp = c.kind === 'OTP' ? findOtp(m.subject, m.text) : null;
    const row = await this.db.opsMail.create({
      data: {
        fromAddr: m.from.slice(0, 300), toAddr: m.to.slice(0, 300), subject: m.subject.slice(0, 300), kind: c.kind, marketplace: c.marketplace,
        bodyCipher: encrypt(m.text), otpCipher: otp ? encrypt(otp) : null, otpExpiresAt: otp ? new Date(Date.now() + OTP_TTL_MS) : null,
      },
    });
    return { stored: true, id: row.id, kind: c.kind };
  }

  /** Staff inbox: no bodies, no OTPs — only whether a fresh OTP is waiting. */
  async list() {
    const rows = await this.db.opsMail.findMany({ orderBy: { receivedAt: 'desc' }, take: 50 });
    const now = Date.now();
    return rows.map((r) => ({ id: r.id, receivedAt: r.receivedAt, from: r.fromAddr, subject: r.subject, kind: r.kind, marketplace: r.marketplace, otpWaiting: Boolean(r.otpCipher && r.otpExpiresAt && r.otpExpiresAt.getTime() > now) }));
  }

  /** One read: returns the OTP and deletes it. */
  async takeOtp(user: AuthUser, id: string) {
    const r = await this.db.opsMail.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Mail not found');
    await this.db.opsMail.update({ where: { id }, data: { otpCipher: null, otpExpiresAt: null } });
    if (!r.otpCipher || !r.otpExpiresAt || r.otpExpiresAt.getTime() <= Date.now()) throw new NotFoundException('No valid OTP on this mail — request a new one.');
    await this.audit.log({ actor: user, action: 'ops_mail.otp_read', entity: 'OpsMail', entityId: id });
    return { otp: decrypt(r.otpCipher), receivedAt: r.receivedAt };
  }

  /** Full text (e.g. an invite link) — operations managers only, audited. */
  async read(user: AuthUser, id: string) {
    if (!['SUPER_ADMIN', 'OPERATIONS_MANAGER'].includes(user.staffRole ?? '')) throw new ForbiddenException('Only operations managers can open ops mail');
    const r = await this.db.opsMail.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Mail not found');
    await this.audit.log({ actor: user, action: 'ops_mail.read', entity: 'OpsMail', entityId: id });
    const text = decrypt(r.bodyCipher);
    return { id, from: r.fromAddr, subject: r.subject, receivedAt: r.receivedAt, text: r.kind === 'OTP' ? text.replace(/\b\d{4,8}\b/g, '••••••') : text };
  }

  async sweep() {
    await this.db.opsMail.updateMany({ where: { otpExpiresAt: { lte: new Date() } }, data: { otpCipher: null, otpExpiresAt: null } });
    await this.db.opsMail.deleteMany({ where: { receivedAt: { lt: new Date(Date.now() - KEEP_DAYS * 86_400_000) } } });
  }
}
