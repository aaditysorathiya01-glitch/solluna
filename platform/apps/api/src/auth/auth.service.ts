import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { z } from 'zod';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { parse } from '../common/zod';
import type { AuthUser } from './auth.types';
import { isValidGstin } from '../billing/gst';

const INDIAN_MOBILE = /^(\+91)?[6-9]\d{9}$/;
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export const RegisterSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().trim().regex(INDIAN_MOBILE, 'Enter a valid Indian mobile number'),
  password: z.string().min(10, 'Use at least 10 characters').max(128),
  legalName: z.string().trim().min(2).max(200),
  brandName: z.string().trim().max(200).optional(),
  gstin: z.string().trim().toUpperCase().regex(GSTIN, 'Invalid GSTIN').refine(isValidGstin, 'Invalid GSTIN check digit').optional(),
  category: z.string().trim().max(100).optional(),
});
export const LoginSchema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) });

const normalizePhone = (p: string) => (p.startsWith('+91') ? p : `+91${p}`);

@Injectable()
export class AuthService {
  /** Set by ChatService wiring: assigns a manager after registration (onboarding step 7). */
  onRegistered?: (organizationId: string) => Promise<unknown>;

  constructor(private readonly db: PrismaService, private readonly jwt: JwtService, private readonly audit: AuditService) {}

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
      const u = await tx.user.create({ data: { type: 'CUSTOMER', email: d.email, phone, name: d.name, passwordHash, organizationId: org.id } });
      await this.audit.log({ actor: null, action: 'customer.register', entity: 'User', entityId: u.id, organizationId: org.id, ip }, tx);
      return u;
    });
    await this.onRegistered?.(user.organizationId!);
    return this.issue(user.id);
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
    await this.audit.log({ actor: null, action: 'auth.login', entity: 'User', entityId: user.id, organizationId: user.organizationId, ip });
    return this.issue(user.id);
  }

  async createStaff(actor: AuthUser, input: unknown) {
    const d = parse(z.object({
      name: z.string().trim().min(2), email: z.string().trim().toLowerCase().email(), password: z.string().min(12),
      staffRole: z.enum(['SUPER_ADMIN', 'OPERATIONS_MANAGER', 'LISTING_EXECUTIVE', 'ADS_MANAGER', 'SUPPORT_EXECUTIVE', 'ACCOUNTS_EXECUTIVE']),
    }), input);
    if (await this.db.user.findUnique({ where: { email: d.email } })) throw new ConflictException('Email already in use');
    const u = await this.db.user.create({
      data: { type: 'STAFF', name: d.name, email: d.email, staffRole: d.staffRole, passwordHash: await bcrypt.hash(d.password, 12) },
    });
    await this.audit.log({ actor, action: 'staff.create', entity: 'User', entityId: u.id, after: { staffRole: d.staffRole } });
    return { id: u.id, email: u.email, staffRole: u.staffRole };
  }

  async setActive(actor: AuthUser, userId: string, isActive: boolean) {
    const before = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    const u = await this.db.user.update({ where: { id: userId }, data: { isActive } });
    await this.audit.log({ actor, action: isActive ? 'user.reactivate' : 'user.deactivate', entity: 'User', entityId: u.id, organizationId: u.organizationId, before: { isActive: before.isActive }, after: { isActive } });
    return { id: u.id, isActive: u.isActive };
  }

  async me(user: AuthUser) {
    const org = user.organizationId ? await this.db.organization.findUnique({ where: { id: user.organizationId } }) : null;
    return { user, organization: org && { id: org.id, legalName: org.legalName, brandName: org.brandName, gstin: org.gstin } };
  }

  private async issue(userId: string) {
    return { token: await this.jwt.signAsync({ sub: userId }) };
  }
}
