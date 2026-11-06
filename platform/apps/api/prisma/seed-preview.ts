/**
 * TEMPORARY TESTING ENVIRONMENT ONLY (Render preview). Never runs in production.
 *
 * Gives the demo client accounts an ACTIVE plan so their dashboards and plan-gated workflows can be tested
 * while Razorpay is not configured. It creates NO Payment rows and NO tax invoices: nothing is presented as
 * paid. Each subscription is written to the audit log as `preview.demo_subscription`.
 *
 * Runs only when PREVIEW_MODE=true, refuses any APP_URL on solluna.co.in, and only touches customers whose
 * email ends in @demo.solluna.co.in. Idempotent: an org that already has a live subscription is skipped.
 *   PREVIEW_DEMO_SUBSCRIPTIONS="riya@demo.solluna.co.in:GROWTH,amit@demo.solluna.co.in:RESELLER"
 */
import { PrismaClient } from '@prisma/client';

const DEMO_DOMAIN = '@demo.solluna.co.in';
const prisma = new PrismaClient();

async function main() {
  if (process.env.PREVIEW_MODE !== 'true') return console.log('seed-preview: PREVIEW_MODE is not true — skipped.');
  if (/solluna\.co\.in/i.test(process.env.APP_URL ?? '')) throw new Error('seed-preview refuses to run against the production domain');
  // Checkout attempts that never reached a payment gateway (no order id) on demo accounts are test debris: remove them.
  const debris = await prisma.payment.deleteMany({ where: { razorpayOrderId: null, status: 'INITIATED', organization: { contactEmail: { endsWith: DEMO_DOMAIN } } } });
  const pending = await prisma.subscription.deleteMany({ where: { status: 'PENDING_PAYMENT', organization: { contactEmail: { endsWith: DEMO_DOMAIN } }, NOT: { id: { in: (await prisma.payment.findMany({ where: { subscriptionId: { not: null } }, select: { subscriptionId: true } })).map((p) => p.subscriptionId!) } } } });
  if (debris.count || pending.count) console.log(`seed-preview: removed ${debris.count} gateway-less payment attempt(s), ${pending.count} unpaid draft subscription(s) on demo accounts`);
  const pairs = (process.env.PREVIEW_DEMO_SUBSCRIPTIONS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const pair of pairs) {
    const [email, code] = pair.split(':').map((s) => s.trim());
    if (!email?.toLowerCase().endsWith(DEMO_DOMAIN) || !code) { console.warn(`seed-preview: ignored "${pair}"`); continue; }
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user?.organizationId || user.type !== 'CUSTOMER') { console.log(`seed-preview: ${email} not registered yet — skipped.`); continue; }
    const live = await prisma.subscription.findFirst({ where: { organizationId: user.organizationId, status: { in: ['ACTIVE', 'GRACE_PERIOD'] } } });
    if (live) continue;
    const plan = await prisma.plan.findUnique({ where: { code } });
    if (!plan) throw new Error(`seed-preview: unknown plan ${code}`);
    const start = new Date();
    const end = new Date(start.getTime() + 30 * 86_400_000);
    const sub = await prisma.subscription.create({ data: { organizationId: user.organizationId, planId: plan.id, status: 'ACTIVE', currentPeriodStart: start, currentPeriodEnd: end } });
    await prisma.auditLog.create({ data: { actorType: 'SYSTEM', organizationId: user.organizationId, action: 'preview.demo_subscription', entity: 'Subscription', entityId: sub.id, after: { plan: code, note: 'Preview demo plan — no payment, no invoice' } } });
    console.log(`seed-preview: ${email} → ${code} (demo, unpaid) until ${end.toISOString().slice(0, 10)}`);
  }
}

main().finally(() => prisma.$disconnect());
