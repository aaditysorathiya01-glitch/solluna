import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { z } from 'zod';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { parse } from '../common/zod';
import { config } from '../common/config';
import { decrypt, encrypt, newTotpSecret, randomToken, sha256, verifyTotp } from '../common/crypto';
import { DispatcherService } from '../connectors/dispatcher.service';
import type { AuthUser } from './auth.types';
import { isValidGstin } from '../billing/gst';

const INDIAN_MOBILE = /^(\+91)?[6-9]\d{9}$/;
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PASSWORD = z.string().min(10, 'Use at least 10 characters').max(128);
const STAFF_ROLES = ['SUPER_ADMIN', 'OPERATIONS_MANAGER', 'LISTING_EXECUTIVE', 'ADS_MANAGER', 'SUPPORT_EXECUTIVE', 'ACCOUNTS_EXECUTIVE'] as const;
const RESET_TTL_MS = 30 * 60_000;
const VERIFY_TTL_MS = 48 * 3600_000;

export const RegisterSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().trim().regex(INDIAN_MOBILE, 'Enter a valid Indian mobile number'),
  password: PASSWORD,
  legalName: z.string().trim().min(2).max(200),
  brandName: z.string().trim().max(200).optional(),
  gstin: z.string().trim().toUpperCase().regex(GSTIN, 'Invalid GSTIN').refine(isValidGstin, 'Invalid GSTIN check digit').optional(),
  category: z.string().trim().max(100).optional(),
});
export const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code').optional(),
});

const normalizePhone = (p: string) => (p.startsWith('+91') ? p : `+91${p}`);

/** Thrown when the password is right but a 2FA code is still needed. */
export class TwoFactorRequired extends UnauthorizedException {
  constructor(message = 'Enter the 6-digit code from your authenticator app') { super({ message, twoFactorRequired: true }); }
}

@Injectable()
export class AuthService {
  private readonly log = new Logger('Auth');
  /** Set by ChatService wiring: assigns a manager after registration (onboarding step 7). */
  onRegistered?: (organizationId: string) => Promise<unknown>;

  constructor(private readonly db: PrismaService, private readonly jwt: JwtService, private readonly audit: AuditService, private readonly dispatch: DispatcherService) {}

  /** Creates the customer user, their organization and the org's Manager Chat conversation in one transaction. */
  async register(input: unknown, ip?: string) {
    const d = parse(RegisterSchema, input);
    const phone = normalizePhone(d.phone);
    const exists = await this.db.user.findFirst({ where: { OR: [{ email: d.email }, { phone }] } });
    if (exists) throw new ConflictException('An account with this email or mobile already exists');

    const passwordHash = await bcrypt.hash(d.password, 12);
    const user = await this.db.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: { legalName: d.legalName, brandName: d.brandName, gstin: d.gstin, stateCode: d.gstin?.slice(0, 2), category: d.category, contactEmail: d.email, contactPhone: phone },
      });
      await tx.conversation.create({ data: { organizationId: org.id } });
      const u = await tx.user.create({ data: { type: 'CUSTOMER', email: d.email, phone, name: d.name, passwordHash, organizationId: org.id, lastLoginAt: new Date() } });
      await this.audit.log({ actor: null, action: 'customer.register', entity: 'User', entityId: u.id, organizationId: org.id, ip }, tx);
      return u;
    });
    await this.onRegistered?.(user.organizationId!);
    await this.dispatch.notifyStaff({ roles: ['SUPER_ADMIN', 'OPERATIONS_MANAGER'], type: 'admin.new_registration', organizationId: user.organizationId!, title: `New client registered: ${d.brandName || d.legalName}`, body: `${d.name} (${d.email}) created an account. Plan not yet paid.` });
    const verify = await this.sendVerification(user.id);
    return { ...(await this.issue(user.id)), ...(verify ? { devLink: verify } : {}) };
  }

  async login(input: unknown, ip?: string) {
    const d = parse(LoginSchema, input);
    const user = await this.db.user.findUnique({ where: { email: d.email } });
    // Same error for unknown email / wrong password / disabled to avoid account enumeration.
    const ok = user?.passwordHash && user.isActive && (await bcrypt.compare(d.password, user.passwordHash));
    if (!user || !ok) {
      await this.audit.log({ actor: null, action: 'auth.login_failed', entity: 'User', entityId: user?.id, ip });
      throw new UnauthorizedException('Invalid email or password');
    }
    if (user.twoFactorEnabledAt && user.twoFactorSecret) {
      if (!d.code) throw new TwoFactorRequired();
      if (!verifyTotp(decrypt(user.twoFactorSecret), d.code)) {
        await this.audit.log({ actor: null, action: 'auth.2fa_failed', entity: 'User', entityId: user.id, ip });
        throw new TwoFactorRequired('That code did not match. Check the time on your phone and try again.');
      }
    }
    await this.db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.log({ actor: null, action: 'auth.login', entity: 'User', entityId: user.id, organizationId: user.organizationId, ip });
    return this.issue(user.id);
  }

  // ───────── Password recovery & email verification ─────────

  /** Always answers the same way, whether or not the email exists (no account enumeration). */
  async forgotPassword(input: unknown, ip?: string) {
    const { email } = parse(z.object({ email: z.string().trim().toLowerCase().email() }), input);
    const user = await this.db.user.findUnique({ where: { email } });
    let devLink: string | undefined;
    if (user?.isActive && user.passwordHash) {
      const token = await this.createToken(user.id, 'RESET_PASSWORD', RESET_TTL_MS);
      const link = `${config.appUrl}/reset-password?token=${token}`;
      const delivery = await this.dispatch.direct({ type: 'auth.password_reset', to: user.email, name: user.name, title: 'Reset your SOLLUNA password', body: `Use this link within 30 minutes to set a new password: ${link}\nIf you did not ask for this, ignore this email.`, link });
      await this.audit.log({ actor: null, action: 'auth.password_reset_requested', entity: 'User', entityId: user.id, organizationId: user.organizationId, ip, after: { delivery } });
      devLink = this.devLink(link, delivery);
    }
    return { ok: true, message: 'If an account exists for this email, a reset link has been sent.', ...(devLink ? { devLink } : {}) };
  }

  async resetPassword(input: unknown, ip?: string) {
    const d = parse(z.object({ token: z.string().min(20), password: PASSWORD }), input);
    const row = await this.consumeToken(d.token, 'RESET_PASSWORD');
    const user = await this.db.user.update({
      where: { id: row.userId },
      // Resetting via an emailed link also proves the email address.
      data: { passwordHash: await bcrypt.hash(d.password, 12), passwordChangedAt: new Date(), emailVerified: new Date() },
    });
    await this.db.authToken.updateMany({ where: { userId: user.id, purpose: 'RESET_PASSWORD', usedAt: null }, data: { usedAt: new Date() } });
    await this.audit.log({ actor: null, action: 'auth.password_reset', entity: 'User', entityId: user.id, organizationId: user.organizationId, ip });
    await this.dispatch.direct({ type: 'auth.password_changed', to: user.email, name: user.name, title: 'Your SOLLUNA password was changed', body: 'Your password was just reset. If this was not you, contact SOLLUNA support immediately.' });
    return { ok: true };
  }

  async changePassword(actor: AuthUser, input: unknown) {
    const d = parse(z.object({ currentPassword: z.string().min(1), newPassword: PASSWORD }), input);
    const user = await this.db.user.findUniqueOrThrow({ where: { id: actor.id } });
    if (!user.passwordHash || !(await bcrypt.compare(d.currentPassword, user.passwordHash))) throw new BadRequestException('Current password is incorrect');
    if (d.currentPassword === d.newPassword) throw new BadRequestException('Choose a password different from the current one');
    // Other sessions issued before now are invalidated; this request gets a fresh session.
    await this.db.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(d.newPassword, 12), passwordChangedAt: new Date() } });
    await this.audit.log({ actor, action: 'auth.password_change', entity: 'User', entityId: user.id });
    await this.dispatch.direct({ type: 'auth.password_changed', to: user.email, name: user.name, title: 'Your SOLLUNA password was changed', body: 'Your password was changed from your account settings. If this was not you, contact SOLLUNA support immediately.' });
    return this.issue(user.id);
  }

  async requestVerification(actor: AuthUser) {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: actor.id } });
    if (user.emailVerified) return { ok: true, alreadyVerified: true };
    const devLink = await this.sendVerification(user.id);
    return { ok: true, ...(devLink ? { devLink } : {}) };
  }

  async verifyEmail(input: unknown) {
    const { token } = parse(z.object({ token: z.string().min(20) }), input);
    const row = await this.consumeToken(token, 'VERIFY_EMAIL');
    const u = await this.db.user.update({ where: { id: row.userId }, data: { emailVerified: new Date() } });
    await this.audit.log({ actor: null, action: 'auth.email_verified', entity: 'User', entityId: u.id, organizationId: u.organizationId });
    return { ok: true, email: u.email };
  }

  private async sendVerification(userId: string) {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    const token = await this.createToken(user.id, 'VERIFY_EMAIL', VERIFY_TTL_MS);
    const link = `${config.appUrl}/verify-email?token=${token}`;
    const delivery = await this.dispatch.direct({ type: 'auth.verify_email', to: user.email, name: user.name, title: 'Confirm your email for SOLLUNA', body: `Confirm your email address: ${link}`, link });
    return this.devLink(link, delivery);
  }

  /** Links are returned to the caller only in explicit dev/preview mode with no email connector. */
  private devLink(link: string, delivery: string) {
    if (delivery === 'sent') return undefined;
    if (config.exposeAuthLinks) return link;
    this.log.warn(`Email connector not configured — link not delivered (${link.split('?')[0]})`);
    return undefined;
  }

  private async createToken(userId: string, purpose: string, ttlMs: number) {
    const token = randomToken();
    await this.db.authToken.create({ data: { userId, purpose, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlMs) } });
    return token;
  }

  private async consumeToken(token: string, purpose: string) {
    const row = await this.db.authToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row || row.purpose !== purpose || row.usedAt || row.expiresAt < new Date()) throw new BadRequestException('This link is invalid or has expired. Request a new one.');
    const used = await this.db.authToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
    if (!used.count) throw new BadRequestException('This link has already been used.');
    const user = await this.db.user.findUnique({ where: { id: row.userId } });
    if (!user?.isActive) throw new BadRequestException('This account is not active.');
    return row;
  }

  // ───────── Two-factor authentication (TOTP) ─────────

  async setup2fa(actor: AuthUser) {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: actor.id } });
    if (user.twoFactorEnabledAt) throw new ConflictException('Two-factor authentication is already on');
    const secret = newTotpSecret();
    await this.db.user.update({ where: { id: user.id }, data: { twoFactorSecret: encrypt(secret) } });
    const label = encodeURIComponent(`SOLLUNA:${user.email}`);
    return { secret, otpauthUrl: `otpauth://totp/${label}?secret=${secret}&issuer=SOLLUNA&algorithm=SHA1&digits=6&period=30` };
  }

  async enable2fa(actor: AuthUser, input: unknown) {
    const { code } = parse(z.object({ code: z.string().trim() }), input);
    const user = await this.db.user.findUniqueOrThrow({ where: { id: actor.id } });
    if (!user.twoFactorSecret) throw new BadRequestException('Start setup first');
    if (user.twoFactorEnabledAt) return { enabled: true };
    if (!verifyTotp(decrypt(user.twoFactorSecret), code)) throw new BadRequestException('That code did not match. Check the time on your phone and try again.');
    await this.db.user.update({ where: { id: user.id }, data: { twoFactorEnabledAt: new Date() } });
    await this.audit.log({ actor, action: 'auth.2fa_enabled', entity: 'User', entityId: user.id });
    return { enabled: true };
  }

  async disable2fa(actor: AuthUser, input: unknown) {
    const { code } = parse(z.object({ code: z.string().trim() }), input);
    const user = await this.db.user.findUniqueOrThrow({ where: { id: actor.id } });
    if (!user.twoFactorEnabledAt || !user.twoFactorSecret) return { enabled: false };
    if (user.staffRole === 'SUPER_ADMIN' && config.requireAdmin2fa) throw new ForbiddenException('Two-factor authentication is mandatory for super admins');
    if (!verifyTotp(decrypt(user.twoFactorSecret), code)) throw new BadRequestException('That code did not match');
    await this.db.user.update({ where: { id: user.id }, data: { twoFactorEnabledAt: null, twoFactorSecret: null } });
    await this.audit.log({ actor, action: 'auth.2fa_disabled', entity: 'User', entityId: user.id });
    return { enabled: false };
  }

  /** Super admin resets a locked-out employee's 2FA (they re-enroll at next sign-in). */
  async reset2fa(actor: AuthUser, userId: string) {
    const u = await this.db.user.findUnique({ where: { id: userId } });
    if (!u || u.type !== 'STAFF') throw new NotFoundException('Staff member not found');
    await this.db.user.update({ where: { id: userId }, data: { twoFactorEnabledAt: null, twoFactorSecret: null, passwordChangedAt: new Date() } });
    await this.audit.log({ actor, action: 'staff.2fa_reset', entity: 'User', entityId: userId });
    return { ok: true };
  }

  // ───────── Profile ─────────

  async updateProfile(actor: AuthUser, input: unknown) {
    const d = parse(z.object({
      name: z.string().trim().min(2).max(100).optional(),
      phone: z.string().trim().regex(INDIAN_MOBILE, 'Enter a valid Indian mobile number').optional(),
    }).strict(), input);
    const phone = d.phone ? normalizePhone(d.phone) : undefined;
    if (phone && (await this.db.user.findFirst({ where: { phone, id: { not: actor.id } } }))) throw new ConflictException('This mobile number is used by another account');
    const u = await this.db.user.update({ where: { id: actor.id }, data: { ...(d.name ? { name: d.name } : {}), ...(phone ? { phone, phoneVerified: null } : {}) } });
    await this.audit.log({ actor, action: 'user.profile_update', entity: 'User', entityId: u.id, after: { name: u.name, phone: u.phone } });
    return { name: u.name, phone: u.phone };
  }

  /** Business details (onboarding step 4). GSTIN/state/address are edited in Billing because they print on invoices. */
  async updateOrganization(actor: AuthUser, input: unknown) {
    const d = parse(z.object({
      legalName: z.string().trim().min(2).max(200).optional(),
      brandName: z.string().trim().max(200).optional(),
      category: z.string().trim().max(100).optional(),
      pan: z.string().trim().toUpperCase().regex(/^[A-Z]{5}\d{4}[A-Z]$/, 'Enter a valid PAN').optional().or(z.literal('').transform(() => undefined)),
      contactEmail: z.string().trim().toLowerCase().email().optional(),
      contactPhone: z.string().trim().regex(INDIAN_MOBILE, 'Enter a valid Indian mobile number').optional(),
    }).strict(), input);
    const orgId = actor.organizationId!;
    const before = await this.db.organization.findUniqueOrThrow({ where: { id: orgId } });
    if (d.pan && before.gstin && before.gstin.slice(2, 12) !== d.pan) throw new BadRequestException('PAN does not match the PAN inside your GSTIN');
    const org = await this.db.organization.update({
      where: { id: orgId },
      data: { ...d, ...(d.contactPhone ? { contactPhone: normalizePhone(d.contactPhone) } : {}), ...(d.pan === undefined && before.gstin && !before.pan ? { pan: before.gstin.slice(2, 12) } : {}) },
    });
    await this.audit.log({ actor, action: 'organization.update', entity: 'Organization', entityId: orgId, before: { legalName: before.legalName, brandName: before.brandName, category: before.category }, after: d });
    return { legalName: org.legalName, brandName: org.brandName, category: org.category, pan: org.pan, contactEmail: org.contactEmail, contactPhone: org.contactPhone };
  }

  // ───────── Staff administration ─────────

  async createStaff(actor: AuthUser, input: unknown) {
    const d = parse(z.object({
      name: z.string().trim().min(2), email: z.string().trim().toLowerCase().email(), password: z.string().min(12, 'Staff passwords need at least 12 characters'),
      staffRole: z.enum(STAFF_ROLES),
    }), input);
    if (await this.db.user.findUnique({ where: { email: d.email } })) throw new ConflictException('Email already in use');
    const u = await this.db.user.create({
      data: { type: 'STAFF', name: d.name, email: d.email, staffRole: d.staffRole, passwordHash: await bcrypt.hash(d.password, 12) },
    });
    await this.audit.log({ actor, action: 'staff.create', entity: 'User', entityId: u.id, after: { staffRole: d.staffRole } });
    return { id: u.id, email: u.email, staffRole: u.staffRole };
  }

  async setRole(actor: AuthUser, userId: string, input: unknown) {
    const { staffRole } = parse(z.object({ staffRole: z.enum(STAFF_ROLES) }), input);
    const before = await this.db.user.findUnique({ where: { id: userId } });
    if (!before || before.type !== 'STAFF') throw new NotFoundException('Staff member not found');
    if (userId === actor.id) throw new BadRequestException('You cannot change your own role');
    await this.guardLastAdmin(before, staffRole !== 'SUPER_ADMIN');
    const u = await this.db.user.update({ where: { id: userId }, data: { staffRole } });
    await this.audit.log({ actor, action: 'staff.role_change', entity: 'User', entityId: u.id, before: { staffRole: before.staffRole }, after: { staffRole } });
    return { id: u.id, staffRole: u.staffRole };
  }

  async setActive(actor: AuthUser, userId: string, isActive: boolean) {
    const before = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    if (!isActive && userId === actor.id) throw new BadRequestException('You cannot deactivate your own account');
    if (!isActive) await this.guardLastAdmin(before, true);
    const u = await this.db.user.update({ where: { id: userId }, data: { isActive } });
    await this.audit.log({ actor, action: isActive ? 'user.reactivate' : 'user.deactivate', entity: 'User', entityId: u.id, organizationId: u.organizationId, before: { isActive: before.isActive }, after: { isActive } });
    return { id: u.id, isActive: u.isActive };
  }

  private async guardLastAdmin(user: { id: string; staffRole: string | null; isActive: boolean }, removing: boolean) {
    if (!removing || user.staffRole !== 'SUPER_ADMIN' || !user.isActive) return;
    const others = await this.db.user.count({ where: { staffRole: 'SUPER_ADMIN', isActive: true, id: { not: user.id } } });
    if (!others) throw new BadRequestException('At least one active super admin must remain');
  }

  async me(user: AuthUser) {
    const [u, org] = await Promise.all([
      this.db.user.findUniqueOrThrow({ where: { id: user.id } }),
      user.organizationId ? this.db.organization.findUnique({ where: { id: user.organizationId } }) : null,
    ]);
    return {
      user: { ...user, phone: u.phone, emailVerified: Boolean(u.emailVerified), twoFactorEnabled: Boolean(u.twoFactorEnabledAt), twoFactorRequired: u.staffRole === 'SUPER_ADMIN' && config.requireAdmin2fa && !u.twoFactorEnabledAt },
      organization: org && { id: org.id, legalName: org.legalName, brandName: org.brandName, gstin: org.gstin, pan: org.pan, category: org.category, contactEmail: org.contactEmail, contactPhone: org.contactPhone, onboardedAt: org.onboardedAt },
    };
  }

  private async issue(userId: string) {
    return { token: await this.jwt.signAsync({ sub: userId }) };
  }
}
