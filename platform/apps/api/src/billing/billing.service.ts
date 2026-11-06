import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { parse } from '../common/zod';
import { config } from '../common/config';
import { DispatcherService } from '../connectors/dispatcher.service';
import { RazorpayClient } from './razorpay.client';
import type { AuthUser } from '../auth/auth.types';
import { STATES, amountInWords, computeGst, financialYear, invoiceNumber, isValidGstin, stateOfGstin } from './gst';

const addMonths = (d: Date, n: number) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; };
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const formatInr = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

const ProfileSchema = z.object({
  gstin: z.string().trim().toUpperCase().refine(isValidGstin, 'Invalid GSTIN (format or check digit)').optional().or(z.literal('').transform(() => undefined)),
  stateCode: z.string().refine((c) => c in STATES, 'Select your state').optional(),
  address: z.string().trim().min(5).max(300),
  city: z.string().trim().min(2).max(100),
  pincode: z.string().trim().regex(/^[1-9]\d{5}$/, 'Enter a valid 6-digit PIN code'),
});

/**
 * Subscription lifecycle (plan doc §17):
 * PLAN_SELECTED → PAYMENT_INITIATED → PAYMENT_VERIFIED → SUBSCRIPTION_ACTIVE → SERVICE_ENABLED.
 * Activation happens ONLY from a server-verified Razorpay signature (checkout handler or webhook);
 * the browser's success screen is never trusted. Both paths are idempotent.
 */
@Injectable()
export class BillingService {
  private readonly log = new Logger('Billing');
  /** Set by OrchestratorService to re-run requests that were waiting on plan verification. */
  onActivated?: (organizationId: string) => Promise<void>;

  constructor(
    private readonly db: PrismaService,
    private readonly rzp: RazorpayClient,
    private readonly audit: AuditService,
    private readonly dispatch: DispatcherService,
  ) {}

  async checkout(user: AuthUser, input: unknown) {
    const { planCode } = parse(z.object({ planCode: z.enum(['RESELLER', 'GROWTH', 'PREMIUM']) }), input);
    const orgId = user.organizationId!;
    const plan = await this.db.plan.findUnique({ where: { code: planCode } });
    if (!plan || !plan.isActive) throw new NotFoundException('Plan not available');
    // Refuse before writing anything: no PENDING_PAYMENT subscription or INITIATED payment without a gateway.
    if (!this.rzp.configured) throw new ServiceUnavailableException('Online payments are not configured yet. Please contact SOLLUNA to activate your plan.');

    // Renewing the same plan extends the current subscription; a different plan starts a new one
    // (the old one is closed when the new payment is verified).
    const current = await this.db.subscription.findFirst({ where: { organizationId: orgId, status: { in: ['ACTIVE', 'GRACE_PERIOD', 'PAST_DUE'] } }, orderBy: { createdAt: 'desc' } });
    const subscription = current && current.planId === plan.id
      ? current
      : (await this.db.subscription.findFirst({ where: { organizationId: orgId, planId: plan.id, status: 'PENDING_PAYMENT' } }))
        ?? (await this.db.subscription.create({ data: { organizationId: orgId, planId: plan.id, status: 'PENDING_PAYMENT' } }));

    // Prices are GST-exclusive: plan price = taxable value, GST added per place of supply.
    const supplierState = this.supplierState();
    const org = await this.db.organization.findUniqueOrThrow({ where: { id: orgId } });
    const pos = org.gstin ? stateOfGstin(org.gstin) : org.stateCode;
    if (!pos || !org.address || !org.pincode) throw new BadRequestException('Add your billing address and state (or GSTIN) before paying — it is required on your GST invoice');
    const tax = computeGst(plan.pricePaise, supplierState, pos, config.gstRateBps);

    const payment = await this.db.payment.create({
      data: { organizationId: orgId, subscriptionId: subscription.id, amountPaise: tax.totalPaise, taxablePaise: tax.taxablePaise, taxPaise: tax.taxPaise, placeOfSupply: pos },
    });
    const order = await this.rzp.createOrder(tax.totalPaise, payment.id, { organizationId: orgId, planCode, paymentId: payment.id });
    if (order.amount !== tax.totalPaise || order.currency !== 'INR') throw new BadRequestException('Gateway returned an unexpected amount');
    await this.db.payment.update({ where: { id: payment.id }, data: { razorpayOrderId: order.id } });
    await this.audit.log({ actor: user, action: 'payment.initiated', entity: 'Payment', entityId: payment.id, after: { planCode, ...tax, orderId: order.id } });

    return { paymentId: payment.id, orderId: order.id, amount: order.amount, currency: order.currency, keyId: this.rzp.keyId, plan: { code: plan.code, name: plan.name }, tax };
  }

  /** Called with the fields Razorpay Checkout returns to the browser. */
  async verifyCheckout(user: AuthUser, input: unknown) {
    const d = parse(z.object({ razorpay_order_id: z.string().min(1), razorpay_payment_id: z.string().min(1), razorpay_signature: z.string().min(1) }), input);
    const payment = await this.db.payment.findUnique({ where: { razorpayOrderId: d.razorpay_order_id } });
    if (!payment || payment.organizationId !== user.organizationId) throw new NotFoundException('Payment not found');
    if (!this.rzp.verifyCheckoutSignature(d.razorpay_order_id, d.razorpay_payment_id, d.razorpay_signature)) {
      await this.audit.log({ actor: user, action: 'payment.signature_invalid', entity: 'Payment', entityId: payment.id });
      throw new BadRequestException('Payment signature verification failed — subscription not activated');
    }
    return this.activate(payment.id, d.razorpay_payment_id, 'checkout');
  }

  async handleWebhook(rawBody: Buffer | undefined, signature: string | undefined) {
    if (!rawBody || !this.rzp.verifyWebhookSignature(rawBody, signature)) throw new BadRequestException('Invalid webhook signature');
    const event = JSON.parse(rawBody.toString('utf8')) as {
      event: string;
      payload: { payment?: { entity: { id: string; order_id: string; amount: number; status: string; error_description?: string } } };
    };
    const p = event.payload.payment?.entity;
    if (!p) return { ignored: event.event };
    const payment = await this.db.payment.findUnique({ where: { razorpayOrderId: p.order_id } });
    if (!payment) return { ignored: 'unknown order' };

    if (event.event === 'payment.captured' || event.event === 'order.paid') {
      if (p.amount !== payment.amountPaise) {
        this.log.error(`Amount mismatch on ${payment.id}: expected ${payment.amountPaise}, got ${p.amount}`);
        await this.audit.log({ action: 'payment.amount_mismatch', entity: 'Payment', entityId: payment.id, organizationId: payment.organizationId, after: { amount: p.amount } });
        return { ignored: 'amount mismatch' };
      }
      return this.activate(payment.id, p.id, 'webhook');
    }
    if (event.event === 'payment.failed') {
      if (payment.status === 'VERIFIED') return { ignored: 'already verified' };
      await this.db.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', failureReason: p.error_description ?? 'Payment failed', razorpayPaymentId: p.id } });
      await this.audit.log({ action: 'payment.failed', entity: 'Payment', entityId: payment.id, organizationId: payment.organizationId, after: { reason: p.error_description } });
      await this.dispatch.emit({ type: 'payment.failed', organizationId: payment.organizationId, title: 'Payment failed', body: `Your payment of ${formatInr(payment.amountPaise)} did not go through. Your plan has not been changed. Please retry from Billing.` });
      return { status: 'FAILED' };
    }
    return { ignored: event.event };
  }

  /** Idempotent: a payment verified by both checkout and webhook activates exactly once. */
  private async activate(paymentId: string, razorpayPaymentId: string, source: 'checkout' | 'webhook') {
    const result = await this.db.$transaction(async (tx) => {
      const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
      if (payment.status === 'VERIFIED') return { alreadyActive: true, payment };
      if (payment.razorpayPaymentId && payment.razorpayPaymentId !== razorpayPaymentId) throw new ConflictException('Payment id mismatch');

      const sub = await tx.subscription.findUniqueOrThrow({ where: { id: payment.subscriptionId! }, include: { plan: true } });
      const now = new Date();
      const renewing = (sub.status === 'ACTIVE' || sub.status === 'GRACE_PERIOD') && sub.currentPeriodEnd && sub.currentPeriodEnd > now;
      const start = renewing ? sub.currentPeriodEnd! : now;
      const end = addMonths(start, 1);

      await tx.payment.update({ where: { id: payment.id }, data: { status: 'VERIFIED', razorpayPaymentId, verifiedAt: now } });
      await tx.subscription.updateMany({
        where: { organizationId: payment.organizationId, id: { not: sub.id }, status: { in: ['ACTIVE', 'GRACE_PERIOD', 'PAST_DUE', 'PENDING_PAYMENT'] } },
        data: { status: 'CANCELLED' },
      });
      const updated = await tx.subscription.update({
        where: { id: sub.id },
        // currentPeriodStart is the billing anchor (see billingMonthStart); renewals only extend the end.
        data: { status: 'ACTIVE', currentPeriodStart: renewing ? sub.currentPeriodStart : start, currentPeriodEnd: end, graceUntil: null, cancelAtPeriodEnd: false },
      });
      await this.issueInvoice(tx, payment, sub.plan, start, end, now);
      await this.audit.log({ action: 'subscription.activate', entity: 'Subscription', entityId: sub.id, organizationId: payment.organizationId, after: { plan: sub.plan.code, source, periodEnd: end } }, tx);
      return { alreadyActive: false, payment, plan: sub.plan, end, subscription: updated };
    });

    if (!result.alreadyActive) {
      await this.dispatch.emit({
        type: 'subscription.activated', organizationId: result.payment.organizationId,
        title: `${result.plan!.name} plan active`,
        body: `Payment of ${formatInr(result.payment.amountPaise)} verified. Your ${result.plan!.name} plan is active until ${result.end!.toDateString()}.`,
      });
      await this.onActivated?.(result.payment.organizationId);
    }
    return { status: 'ACTIVE', alreadyActive: result.alreadyActive };
  }

  /** Renewal reminders, grace period and past-due transitions. Run on a schedule (SWEEP_INTERVAL_MS) or by admin. */
  async sweep(now = new Date()) {
    const out = { reminders: 0, toGrace: 0, toPastDue: 0, expired: 0 };
    const soon = await this.db.subscription.findMany({
      where: { status: 'ACTIVE', cancelAtPeriodEnd: false, currentPeriodEnd: { gt: now, lte: addDays(now, config.renewalReminderDays) } }, include: { plan: true },
    });
    for (const s of soon) {
      const already = await this.db.auditLog.findFirst({ where: { action: 'subscription.renewal_reminder', entityId: s.id, after: { path: ['periodEnd'], equals: s.currentPeriodEnd!.toISOString() } } });
      if (already) continue;
      await this.audit.log({ action: 'subscription.renewal_reminder', entity: 'Subscription', entityId: s.id, organizationId: s.organizationId, after: { periodEnd: s.currentPeriodEnd!.toISOString() } });
      await this.dispatch.emit({ type: 'subscription.renewal_reminder', organizationId: s.organizationId, title: 'Renewal due', body: `Your ${s.plan.name} plan renews on ${s.currentPeriodEnd!.toDateString()} (${formatInr(s.plan.pricePaise)} + GST).` });
      out.reminders++;
    }
    const expired = await this.db.subscription.findMany({ where: { status: 'ACTIVE', currentPeriodEnd: { lte: now } } });
    for (const s of expired) {
      if (s.cancelAtPeriodEnd) {
        // Client cancelled: service ends at period end, no grace period, no reminders.
        await this.db.subscription.update({ where: { id: s.id }, data: { status: 'EXPIRED' } });
        await this.audit.log({ action: 'subscription.expired', entity: 'Subscription', entityId: s.id, organizationId: s.organizationId, after: { reason: 'cancelled_at_period_end' } });
        await this.dispatch.emit({ type: 'subscription.expired', organizationId: s.organizationId, title: 'Plan ended', body: 'Your plan ended as requested. Your reports, documents and chat history stay available. Re-activate any time from Billing.' });
        out.expired++;
        continue;
      }
      const graceUntil = addDays(s.currentPeriodEnd!, config.graceDays);
      await this.db.subscription.update({ where: { id: s.id }, data: { status: 'GRACE_PERIOD', graceUntil } });
      await this.audit.log({ action: 'subscription.grace_period', entity: 'Subscription', entityId: s.id, organizationId: s.organizationId, after: { graceUntil } });
      await this.dispatch.emit({ type: 'subscription.grace_period', organizationId: s.organizationId, title: 'Payment due', body: `Your plan period has ended. Services continue until ${graceUntil.toDateString()} — renew to avoid interruption.` });
      out.toGrace++;
    }
    const lapsed = await this.db.subscription.findMany({ where: { status: 'GRACE_PERIOD', graceUntil: { lte: now } } });
    for (const s of lapsed) {
      await this.db.subscription.update({ where: { id: s.id }, data: { status: 'PAST_DUE' } });
      await this.audit.log({ action: 'subscription.past_due', entity: 'Subscription', entityId: s.id, organizationId: s.organizationId });
      await this.dispatch.emit({ type: 'subscription.past_due', organizationId: s.organizationId, title: 'Services paused', body: 'Your plan is past due and services are paused. Renew from Billing to resume.' });
      out.toPastDue++;
    }
    return out;
  }

  /** Cancel at period end (no partial-month refunds — see Refund & Cancellation Policy), or undo it. */
  async setCancel(user: AuthUser, input: unknown) {
    const { cancel, reason } = parse(z.object({ cancel: z.boolean(), reason: z.string().trim().max(500).optional() }), input);
    const sub = await this.db.subscription.findFirst({ where: { organizationId: user.organizationId!, status: { in: ['ACTIVE', 'GRACE_PERIOD'] } }, include: { plan: true }, orderBy: { currentPeriodEnd: 'desc' } });
    if (!sub) throw new BadRequestException('No active plan to cancel');
    await this.db.subscription.update({ where: { id: sub.id }, data: { cancelAtPeriodEnd: cancel } });
    await this.audit.log({ actor: user, action: cancel ? 'subscription.cancel_scheduled' : 'subscription.cancel_undone', entity: 'Subscription', entityId: sub.id, after: { reason } });
    await this.dispatch.emit({
      type: 'subscription.cancel_scheduled', organizationId: sub.organizationId,
      title: cancel ? 'Cancellation scheduled' : 'Cancellation withdrawn',
      body: cancel ? `Your ${sub.plan.name} plan stays active until ${sub.currentPeriodEnd?.toDateString()} and will not renew.` : `Your ${sub.plan.name} plan will continue. Renew before ${sub.currentPeriodEnd?.toDateString()} to avoid interruption.`,
    });
    if (cancel) await this.dispatch.notifyStaff({ roles: ['SUPER_ADMIN', 'OPERATIONS_MANAGER'], organizationId: sub.organizationId, type: 'admin.cancellation', title: 'Client scheduled a cancellation', body: reason ?? 'No reason given' });
    return { cancelAtPeriodEnd: cancel, currentPeriodEnd: sub.currentPeriodEnd };
  }

  get invoicingConfigured() {
    const sp = config.supplier;
    return Boolean(sp.legalName && sp.address && sp.gstin && isValidGstin(sp.gstin));
  }

  private supplierState(): string {
    if (!this.invoicingConfigured) throw new ServiceUnavailableException('GST invoicing is not configured (SUPPLIER_LEGAL_NAME, SUPPLIER_GSTIN, SUPPLIER_ADDRESS)');
    return stateOfGstin(config.supplier.gstin!);
  }

  /** Billing details printed on the buyer section of the tax invoice. */
  async updateProfile(user: AuthUser, input: unknown) {
    const d = parse(ProfileSchema, input);
    if (!d.gstin && !d.stateCode) throw new BadRequestException('Provide your GSTIN or select your state');
    const stateCode = d.gstin ? stateOfGstin(d.gstin) : d.stateCode!;
    const before = await this.db.organization.findUniqueOrThrow({ where: { id: user.organizationId! } });
    const org = await this.db.organization.update({
      where: { id: user.organizationId! },
      data: { gstin: d.gstin ?? null, stateCode, address: d.address, city: d.city, pincode: d.pincode },
    });
    await this.audit.log({ actor: user, action: 'billing.profile_update', entity: 'Organization', entityId: org.id, before: { gstin: before.gstin, stateCode: before.stateCode }, after: { gstin: org.gstin, stateCode } });
    return { gstin: org.gstin, stateCode, stateName: STATES[stateCode], address: org.address, city: org.city, pincode: org.pincode };
  }

  /** Issues a GST tax invoice inside the activation transaction. Sequence is gap-free per financial year. */
  private async issueInvoice(
    tx: Prisma.TransactionClient,
    payment: { id: string; organizationId: string; amountPaise: number; taxablePaise: number; placeOfSupply: string | null },
    plan: { name: string },
    periodStart: Date, periodEnd: Date, now: Date,
  ) {
    const org = await tx.organization.findUniqueOrThrow({ where: { id: payment.organizationId } });
    const supplierState = this.supplierState();
    const pos = payment.placeOfSupply!;
    const tax = computeGst(payment.taxablePaise, supplierState, pos, config.gstRateBps);
    if (tax.totalPaise !== payment.amountPaise) throw new ConflictException('Invoice total does not match the amount paid');

    const fy = financialYear(now);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'invoice-seq:' + fy}))`;
    const last = await tx.invoice.findFirst({ where: { financialYear: fy }, orderBy: { sequence: 'desc' }, select: { sequence: true } });
    const sequence = (last?.sequence ?? 0) + 1;
    const sp = config.supplier;
    return tx.invoice.create({
      data: {
        organizationId: org.id, paymentId: payment.id, financialYear: fy, sequence, number: invoiceNumber(fy, sequence), issuedAt: now,
        sac: config.invoiceSac,
        description: `SOLLUNA ${plan.name} plan — Amazon & Flipkart marketplace management services (${periodStart.toLocaleDateString('en-IN')} to ${periodEnd.toLocaleDateString('en-IN')})`,
        periodStart, periodEnd, placeOfSupply: pos, intraState: tax.intraState, gstRateBps: tax.rateBps,
        taxablePaise: tax.taxablePaise, cgstPaise: tax.cgstPaise, sgstPaise: tax.sgstPaise, igstPaise: tax.igstPaise, gstPaise: tax.taxPaise, amountPaise: tax.totalPaise,
        supplier: { legalName: sp.legalName, tradeName: sp.tradeName, gstin: sp.gstin, pan: sp.gstin!.slice(2, 12), address: sp.address, email: sp.email ?? null, stateCode: supplierState, stateName: STATES[supplierState] },
        buyer: { legalName: org.legalName, brandName: org.brandName, gstin: org.gstin, address: org.address, city: org.city, pincode: org.pincode, stateCode: pos, stateName: STATES[pos], email: org.contactEmail, phone: org.contactPhone },
      },
    });
  }

  /** Tax invoice for display/print. Customers see only their own; accounts staff see all. */
  async getInvoice(user: AuthUser, id: string) {
    const inv = await this.db.invoice.findFirst({ where: { id, ...(user.type === 'CUSTOMER' ? { organizationId: user.organizationId! } : {}) } });
    if (!inv) throw new NotFoundException('Invoice not found');
    return { ...inv, amountInWords: amountInWords(inv.amountPaise), placeOfSupplyName: STATES[inv.placeOfSupply] ?? inv.placeOfSupply, reverseCharge: 'No' };
  }

  async billingSummary(user: AuthUser) {
    const orgId = user.organizationId!;
    const [subscriptions, payments, invoices] = await Promise.all([
      this.db.subscription.findMany({ where: { organizationId: orgId }, include: { plan: { select: { code: true, name: true, pricePaise: true } } }, orderBy: { createdAt: 'desc' } }),
      this.db.payment.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, amountPaise: true, status: true, failureReason: true, createdAt: true, verifiedAt: true } }),
      this.db.invoice.findMany({ where: { organizationId: orgId }, orderBy: { issuedAt: 'desc' } }),
    ]);
    const org = await this.db.organization.findUniqueOrThrow({ where: { id: orgId } });
    const profile = { legalName: org.legalName, gstin: org.gstin, address: org.address, city: org.city, pincode: org.pincode, stateCode: org.gstin ? stateOfGstin(org.gstin) : org.stateCode };
    return {
      subscriptions, payments, invoices, profile,
      profileComplete: Boolean(profile.stateCode && org.address && org.pincode),
      paymentsConfigured: this.rzp.configured && this.invoicingConfigured,
      gst: { rateBps: config.gstRateBps, supplierState: config.supplier.gstin ? stateOfGstin(config.supplier.gstin) : null },
      states: STATES,
    };
  }
}
