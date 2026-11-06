'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError, inr, SECTIONS, SECTION_LABEL } from '@/lib/api';
import { loadRazorpay } from '@/lib/razorpay';
import Link from 'next/link';
import { Logo } from './Logo';
import { Markdownish } from './Markdownish';
import { ChatPanel, DocumentsPanel } from './Chat';
import { ClientReporting } from './Reporting';
import { ClientCatalog } from './ClientCatalog';
import { ClientFulfilment, ClientInventory } from './Fulfilment';
import { ClientTickets } from './Tickets';
import { AccountSettings, type MeFull } from './Settings';

type Me = MeFull;
interface Onboarding { complete: boolean; steps: { key: string; label: string; done: boolean; tab: string }[] }
interface Feature { key: string; label: string; section: string; skill: string; enabled: boolean; limit: number | null; used: number | null; access: string; remaining: number | null; meta: { mode?: string } | null }
interface Catalog { plan: { code: string; name: string; status: string; currentPeriodEnd: string } | null; subscriptionVerified: boolean | null; features: Feature[] }
interface TaskLite { id: string; title: string; status: string; skill: string; stepKey: string; blocker: string | null }
interface Req { id: string; title: string; featureKey: string; status: string; entitlement: string; marketplace: string | null; createdAt: string; tasks: TaskLite[] }
interface Approval { id: string; actionType: string; parameters: Record<string, unknown>; status: string; createdAt: string; task: { title: string; requestId: string } | null }
interface BillingProfile { legalName: string; gstin: string | null; address: string | null; city: string | null; pincode: string | null; stateCode: string | null }
interface Billing {
  paymentsConfigured: boolean;
  previewActivation?: boolean;
  profile: BillingProfile;
  profileComplete: boolean;
  gst: { rateBps: number; supplierState: string | null };
  states: Record<string, string>;
  subscriptions: { id: string; status: string; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; plan: { code: string; name: string; pricePaise: number } }[];
  payments: { id: string; amountPaise: number; status: string; failureReason: string | null; createdAt: string }[];
  invoices: { id: string; number: string; amountPaise: number; taxablePaise: number; gstPaise: number; issuedAt: string }[];
}
interface PlanFeatureRow { key: string; label: string; section: string; enabled: boolean; limit: number | null; meta: { mode?: string } | null }
interface Plan { code: string; name: string; pricePaise: number; features: PlanFeatureRow[] }
interface ChatSummary { managers: { id: string; name: string; staffRole: string }[]; messages: { id: string; body: string; senderType: string; createdAt: string; sender: { id: string; name: string } }[] }
interface Notification { id: string; title: string; body: string; createdAt: string; readAt: string | null }

const TABS = ['overview', 'services', 'requests', 'approvals', 'catalog', 'labels', 'inventory', 'tickets', 'chat', 'reports', 'documents', 'billing', 'settings'] as const;
type Tab = (typeof TABS)[number];

export { Status, human } from './ui';
import { Status, human, NotificationBell } from './ui';
import { CONTACT } from './Site';

export function Dashboard() {
  const router = useRouter();
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>((TABS as readonly string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'overview');
  const [me, setMe] = useState<Me | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [requests, setRequests] = useState<Req[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [billing, setBilling] = useState<Billing | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [notes, setNotes] = useState<Notification[]>([]);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [requestFor, setRequestFor] = useState<Feature | null>(null);
  const [onboarding, setOnboarding] = useState<Onboarding | null>(null);
  const [chat, setChat] = useState<ChatSummary | null>(null);

  const load = useCallback(async () => {
    try {
      const m = await api<Me>('/auth/me');
      if (m.user.type === 'STAFF') { router.replace('/ops'); return; }
      setMe(m);
      const [c, r, a, b, p, n, o] = await Promise.all([
        api<Catalog>('/features'), api<Req[]>('/requests'), api<Approval[]>('/approvals'), api<Billing>('/billing'), api<Plan[]>('/plans'), api<Notification[]>('/notifications'), api<Onboarding>('/onboarding'),
      ]);
      setCatalog(c); setRequests(r); setApprovals(a); setBilling(b); setPlans(p); setNotes(n); setOnboarding(o);
      if (c.plan) setChat(await api<ChatSummary>('/chat').catch(() => null));
    } catch (e) {
      if ((e as ApiError).status === 401) router.replace('/login');
      else setFlash({ kind: 'err', text: (e as Error).message });
    }
  }, [router]);

  useEffect(() => { load(); }, [load]);

  const pendingApprovals = approvals.filter((a) => a.status === 'REQUESTED');
  const openRequests = requests.filter((r) => !['COMPLETED', 'CANCELLED', 'PARTIALLY_COMPLETED'].includes(r.status));

  async function logout() { await api('/auth/logout', { method: 'POST' }); router.replace('/login'); }

  if (!me || !catalog || !billing) {
    return <main className="flex min-h-screen items-center justify-center text-ink-3">{flash?.text ?? 'Loading your dashboard…'}</main>;
  }

  const hasPlan = Boolean(catalog.plan);
  const allowed = (k: string) => catalog.features.some((f) => f.key === k && (f.access === 'ALLOWED' || f.access === 'LIMIT_REACHED'));
  // Before the first plan: plans only. After a plan has lapsed: renew, plus read access to past work.
  const lapsed = !hasPlan && billing.subscriptions.some((x) => ['ACTIVE', 'GRACE_PERIOD', 'PAST_DUE', 'EXPIRED', 'CANCELLED'].includes(x.status) && x.currentPeriodEnd);
  const visible: Tab[] = hasPlan
    ? TABS.filter((t) => (t === 'labels' ? allowed('SHIPPING_LABEL_GENERATION') || allowed('PERSONALIZED_THANK_YOU_NOTES') : t === 'inventory' ? allowed('LOW_STOCK_ALERTS') : true))
    : lapsed ? ['overview', 'chat', 'reports', 'documents', 'billing', 'settings'] : [];
  const current: Tab = visible.includes(tab) ? tab : 'overview';
  const go = (t: Tab) => { setTab(t); window.history.replaceState(null, '', `?tab=${t}`); };
  const header = (
    <header className="border-b border-ink/10 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Logo />
        <div className="flex items-center gap-3 text-sm">
          <span className="hidden text-ink-3 sm:inline">{me.organization?.brandName ?? me.organization?.legalName}</span>
          {visible.length > 0 && <NotificationBell />}
          <button className="btn-ghost py-1.5" onClick={logout}>Sign out</button>
        </div>
      </div>
      {visible.length > 0 && (
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 sm:px-6" aria-label="Dashboard">
          {visible.map((t) => (
            <button key={t} onClick={() => go(t)} className={`relative whitespace-nowrap px-3 py-3 text-sm font-medium capitalize ${current === t ? 'text-ink' : 'text-ink-3 hover:text-ink'}`}>
              {TAB_LABEL[t] ?? t}{t === 'approvals' && pendingApprovals.length > 0 && <span className="ml-1.5 chip bg-sun text-ink">{pendingApprovals.length}</span>}
              {current === t && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded bg-sun" />}
            </button>
          ))}
        </nav>
      )}
    </header>
  );
  const flashBox = flash && (
    <div role="status" className={`mb-6 rounded-xl px-4 py-3 text-sm ${flash.kind === 'ok' ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-900'}`}>
      {flash.text} <button className="ml-2 underline" onClick={() => setFlash(null)}>Dismiss</button>
    </div>
  );

  if (!hasPlan && (current === 'overview' || !lapsed)) {
    return (
      <div className="min-h-screen">
        {header}
        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          {flashBox}
          <PlanPicker
            firstName={me.user.name.split(' ')[0]} billing={billing} plans={plans} preselect={params.get('plan')} lapsed={lapsed}
            verifying={catalog.subscriptionVerified === null}
            onDone={(m, activated) => { setFlash(m); if (activated) go('overview'); load(); }}
          />
        </main>
      </div>
    );
  }

  const manager = chat?.managers[0] ?? null;
  const managerNote = manager ? [...(chat?.messages ?? [])].reverse().find((x) => x.senderType === 'STAFF' && x.sender.id === manager.id) : undefined;
  const included = catalog.features.filter((f) => f.access === 'ALLOWED' || f.access === 'LIMIT_REACHED');
  const locked = catalog.features.filter((f) => !(f.access === 'ALLOWED' || f.access === 'LIMIT_REACHED'));

  return (
    <div className="min-h-screen">
      {header}
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {flashBox}

        {current === 'overview' && catalog.plan && (
          <div className="space-y-6">
            <h1 className="font-display text-3xl">Welcome, {me.user.name.split(' ')[0]}</h1>
            <div className="grid gap-4 lg:grid-cols-3">
              <section className="card p-6 lg:col-span-2" aria-label="Your account manager">
                {manager ? (
                  <>
                    <div className="flex items-center gap-4">
                      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-ink font-display text-lg text-sun-2" aria-hidden>{manager.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}</span>
                      <div><p className="label !mb-0">Your account manager</p><p className="font-display text-xl">{manager.name}</p><p className="text-xs text-ink-3">{human(manager.staffRole)} · Mon–Sat, 10 AM–7 PM IST</p></div>
                    </div>
                    {managerNote && <p className="mt-4 line-clamp-6 whitespace-pre-line rounded-xl bg-ivory p-4 text-sm text-ink-2">{managerNote.body}</p>}
                    <button className="btn-primary mt-4" onClick={() => go('chat')}>{managerNote ? `Reply to ${manager.name.split(' ')[0]}` : `Message ${manager.name.split(' ')[0]}`}</button>
                  </>
                ) : (
                  <><p className="label">Your account manager</p><p className="font-display text-xl">Being assigned</p><p className="mt-1 text-sm text-ink-3">Your dedicated manager will message you in Manager chat shortly.</p></>
                )}
              </section>
              <section className="card p-6" aria-label="Your plan">
                <p className="label">Your plan</p>
                <p className="font-display text-2xl">{catalog.plan.name}</p>
                <p className="mt-1 text-xs text-ink-3">Renews {new Date(catalog.plan.currentPeriodEnd).toLocaleDateString('en-IN', { dateStyle: 'medium' })}</p>
                <p className="mt-4 text-sm">Services included <strong>{included.length} / 28</strong></p>
                {['NEW_LISTING_AMAZON', 'NEW_LISTING_FLIPKART'].map((k) => {
                  const f = catalog.features.find((x) => x.key === k)!;
                  return <p key={k} className="mt-1 text-sm text-ink-2">{f.label.replace('New ', '').replace(' / Month', '')}: <strong>{f.limit === null ? `${f.used ?? 0} used · Unlimited` : `${f.used ?? 0} of ${f.limit} used`}</strong></p>;
                })}
                <button className="btn-ghost mt-4 py-1.5 text-xs" onClick={() => go('billing')}>Manage plan</button>
              </section>
            </div>
            {pendingApprovals.length > 0 && (
              <button className="card flex w-full items-center justify-between gap-4 p-5 text-left ring-2 ring-sun" onClick={() => go('approvals')}>
                <span><span className="font-semibold">{pendingApprovals.length} item{pendingApprovals.length > 1 ? 's' : ''} need{pendingApprovals.length > 1 ? '' : 's'} your approval</span><span className="block text-xs text-ink-3">Nothing is spent or changed until you approve.</span></span>
                <span className="btn-gold py-1.5 text-xs">Review</span>
              </button>
            )}
            {onboarding && !onboarding.complete && (
              <section className="card p-6" aria-label="Onboarding checklist">
                <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Finish setting up</h2><span className="text-sm text-ink-3">{onboarding.steps.filter((x) => x.done).length} of {onboarding.steps.length} done</span></div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink/5"><div className="h-full bg-sun" style={{ width: `${(onboarding.steps.filter((x) => x.done).length / onboarding.steps.length) * 100}%` }} /></div>
                <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                  {onboarding.steps.map((st) => (
                    <li key={st.key}>
                      <button className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-ivory" onClick={() => go((visible.includes(st.tab as Tab) ? st.tab : 'overview') as Tab)} disabled={st.done}>
                        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] ${st.done ? 'bg-emerald-600 text-white' : 'border border-ink/25'}`}>{st.done ? '✓' : ''}</span>
                        <span className={st.done ? 'text-ink-3 line-through' : ''}>{st.label}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Stat label="Open requests" value={String(openRequests.length)} />
              <Stat label="Awaiting your approval" value={String(pendingApprovals.length)} highlight={pendingApprovals.length > 0} />
            </div>
            <section className="card p-6">
              <h2 className="font-semibold">Recent updates</h2>
              <ul className="mt-4 divide-y divide-ink/5">
                {notes.slice(0, 6).map((n) => (
                  <li key={n.id} className="py-3"><p className="text-sm font-medium">{n.title}</p><p className="mt-0.5 line-clamp-2 whitespace-pre-line text-xs text-ink-3">{n.body.replace(/\*\*/g, '')}</p></li>
                ))}
                {!notes.length && <li className="py-3 text-sm text-ink-3">No updates yet.</li>}
              </ul>
            </section>
          </div>
        )}

        {current === 'services' && (
          <div className="space-y-8">
            <div><h1 className="font-display text-3xl">Your services</h1><p className="mt-1 text-sm text-ink-3">Everything in your {catalog.plan?.name} plan. Each service is delivered by a SOLLUNA specialist following a documented operating procedure.</p></div>
            {SECTIONS.map((sec) => {
              const list = included.filter((f) => f.section === sec);
              if (!list.length) return null;
              return (
                <section key={sec}>
                  <h2 className="label">{SECTION_LABEL[sec]}</h2>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {list.map((f) => (
                      <div key={f.key} className="card flex flex-col p-5">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="text-sm font-semibold">{f.label}</h3>
                          {f.access === 'ALLOWED' ? <span className="chip bg-emerald-50 text-emerald-800">Included</span> : <span className="chip bg-amber-50 text-amber-800">Limit used</span>}
                        </div>
                        {f.limit !== null && f.enabled && <p className="mt-1 text-xs text-ink-3">{f.used ?? 0} of {f.limit} used this month</p>}
                        {f.meta?.mode && <p className="mt-1 text-xs text-ink-3">{human(f.meta.mode)}</p>}
                        <button className="btn-ghost mt-4 self-start py-1.5 text-xs" onClick={() => setRequestFor(f)}>Request</button>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
            {locked.length > 0 && (
              <section aria-label="Available on higher plans">
                <div className="flex flex-wrap items-end justify-between gap-2"><h2 className="label">Available on higher plans</h2><button className="text-xs font-semibold underline" onClick={() => go('billing')}>Compare plans</button></div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {locked.map((f) => (
                    <div key={f.key} className="card flex items-start justify-between gap-2 p-5 opacity-70">
                      <h3 className="text-sm font-semibold">{f.label}</h3><span className="chip bg-ink/5 text-ink-3">Not in plan</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {current === 'requests' && <Requests requests={requests} onNew={() => go('services')} />}

        {current === 'approvals' && (
          <div className="space-y-4">
            <h1 className="font-display text-3xl">Approvals</h1>
            <p className="text-sm text-ink-3">SOLLUNA never spends your money, changes prices or shares your data without your explicit approval of the exact parameters below.</p>
            {approvals.map((a) => (
              <div key={a.id} className="card p-5">
                <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{a.task?.title ?? human(a.actionType)}</h3><Status s={a.status} /></div>
                <p className="mt-1 text-xs uppercase tracking-wider text-ink-3">{human(a.actionType)}</p>
                <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                  {Object.entries(a.parameters).map(([k, v]) => <div key={k} className="flex justify-between gap-3 border-b border-ink/5 py-1"><dt className="text-ink-3">{k}</dt><dd className="font-medium">{String(v)}</dd></div>)}
                </dl>
                {a.status === 'REQUESTED' && (
                  <div className="mt-4 flex gap-2">
                    <button className="btn-primary" onClick={() => decide(a.id, 'APPROVED')}>Approve</button>
                    <button className="btn-ghost" onClick={() => decide(a.id, 'DECLINED')}>Decline</button>
                  </div>
                )}
              </div>
            ))}
            {!approvals.length && <p className="card p-6 text-sm text-ink-3">Nothing needs your approval.</p>}
          </div>
        )}

        {current === 'catalog' && <ClientCatalog />}
        {current === 'labels' && <ClientFulfilment />}
        {current === 'inventory' && <ClientInventory />}
        {current === 'tickets' && <ClientTickets />}
        {current === 'settings' && <AccountSettings me={me} onDone={(m) => { setFlash(m); api<Me>('/auth/me').then(setMe).catch(() => undefined); }} />}
        {current === 'chat' && <ChatPanel mode="client" />}
        {current === 'reports' && <ClientReporting />}
        {current === 'documents' && <div className="space-y-4"><h1 className="font-display text-3xl">Documents</h1><DocumentsPanel myId={me.user.id} /></div>}
        {current === 'billing' && <BillingTab billing={billing} plans={plans} current={catalog.plan?.code} preselect={params.get('plan')} onDone={(m) => { setFlash(m); load(); }} />}
      </main>

      {requestFor && <RequestModal feature={requestFor} onClose={() => setRequestFor(null)} onCreated={(msg) => { setRequestFor(null); setFlash({ kind: 'ok', text: msg }); go('requests'); load(); }} />}
    </div>
  );

  async function decide(id: string, decision: 'APPROVED' | 'DECLINED') {
    try {
      await api(`/approvals/${id}/decision`, { method: 'POST', body: { decision } });
      setFlash({ kind: 'ok', text: decision === 'APPROVED' ? 'Approved. Your manager has been notified.' : 'Declined. No action will be taken.' });
      load();
    } catch (e) { setFlash({ kind: 'err', text: (e as Error).message }); }
  }
}

const TAB_LABEL: Partial<Record<Tab, string>> = { chat: 'Manager chat', inventory: 'Low stock', labels: 'Labels' };

const PLAN_PITCH: Record<string, string> = {
  RESELLER: 'For sellers starting out: catalog, listings, reports and a dedicated manager.',
  GROWTH: 'We run your ads, stock alerts and daily shipping labels as you scale.',
  PREMIUM: 'Everything, plus strategy, priority calls and branded thank-you notes.',
};

/** Opens Razorpay Checkout for a plan; activation happens only after server-side signature verification. */
async function startCheckout(code: string, onDone: (m: { kind: 'ok' | 'err'; text: string }, activated?: boolean) => void, setBusy: (b: string | null) => void) {
  setBusy(code);
  try {
    const order = await api<{ orderId: string; amount: number; currency: string; keyId: string; plan: { name: string } }>('/billing/checkout', { method: 'POST', body: { planCode: code } });
    await loadRazorpay();
    const rzp = new window.Razorpay!({
      key: order.keyId, order_id: order.orderId, amount: order.amount, currency: order.currency,
      name: 'SOLLUNA', description: `${order.plan.name} plan · 1 month`, theme: { color: '#12131C' },
      handler: async (resp: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
        try {
          await api('/billing/verify', { method: 'POST', body: resp });
          onDone({ kind: 'ok', text: `Payment verified. Your ${order.plan.name} plan is active.` }, true);
        } catch (e) { onDone({ kind: 'err', text: (e as Error).message }); }
        setBusy(null);
      },
      modal: { ondismiss: () => setBusy(null) },
    });
    rzp.on('payment.failed', () => { onDone({ kind: 'err', text: 'Payment failed. Your plan has not changed. Please try again.' }); setBusy(null); });
    rzp.open();
  } catch (e) { onDone({ kind: 'err', text: (e as Error).message }); setBusy(null); }
}

function PlanPicker({ firstName, billing, plans, preselect, lapsed, verifying, onDone }: {
  firstName: string; billing: Billing; plans: Plan[]; preselect: string | null; lapsed: boolean; verifying: boolean;
  onDone: (m: { kind: 'ok' | 'err'; text: string }, activated?: boolean) => void;
}) {
  const [selected, setSelected] = useState<string | null>(plans.some((p) => p.code === preselect) ? preselect : null);
  const [busy, setBusy] = useState<string | null>(null);
  const plan = plans.find((p) => p.code === selected) ?? null;
  useEffect(() => { if (selected) document.getElementById('activate')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [selected]);

  async function previewActivate(code: string) {
    setBusy(code);
    try {
      const r = await api<{ plan: { name: string } }>('/billing/preview-activate', { method: 'POST', body: { planCode: code } });
      onDone({ kind: 'ok', text: `${r.plan.name} plan activated for testing (no payment). Your manager has sent you a welcome message.` }, true);
    } catch (e) { onDone({ kind: 'err', text: (e as Error).message }); }
    setBusy(null);
  }

  return (
    <div className="space-y-8">
      <div className="mx-auto max-w-2xl text-center">
        <p className="label">{lapsed ? 'Your plan has ended' : `Welcome, ${firstName}`}</p>
        <h1 className="font-display text-3xl sm:text-4xl">{lapsed ? 'Renew to continue your services' : 'Choose your plan'}</h1>
        <p className="mt-2 text-sm text-ink-3">Your dedicated SOLLUNA manager is assigned the moment your plan starts. Prices are monthly and exclude GST (18%).</p>
      </div>
      {verifying && <p role="status" className="rounded-xl bg-amber-50 px-4 py-3 text-center text-sm text-amber-900">We are verifying your payment. This page will update once it is confirmed.</p>}

      <div className="grid gap-4 lg:grid-cols-3">
        {plans.map((p) => {
          const on = (k: string) => p.features.find((f) => f.key === k && f.enabled);
          const listing = (k: string) => { const f = on(k); return f ? (f.limit === null ? 'Unlimited' : String(f.limit)) : '—'; };
          const call = on('CALL_SUPPORT')?.meta?.mode;
          const popular = p.code === 'GROWTH';
          const isSel = selected === p.code;
          return (
            <section key={p.code} aria-label={`${p.name} plan`} className={`card relative flex flex-col p-6 ${isSel ? 'ring-2 ring-ink' : popular ? 'ring-2 ring-sun' : ''}`}>
              {popular && <span className="chip absolute -top-3 left-6 bg-sun text-ink">Most popular</span>}
              <p className="label">{p.name}</p>
              <p className="font-display text-4xl">{inr(p.pricePaise)}<span className="font-sans text-sm text-ink-3"> /month + GST</span></p>
              <p className="mt-2 min-h-10 text-sm text-ink-2">{PLAN_PITCH[p.code]}</p>
              <dl className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-ivory p-3 text-center text-xs">
                <div><dt className="text-ink-3">New listings / month</dt><dd className="font-semibold">Amazon {listing('NEW_LISTING_AMAZON')} · Flipkart {listing('NEW_LISTING_FLIPKART')}</dd></div>
                <div><dt className="text-ink-3">Services</dt><dd className="font-semibold">{p.features.filter((f) => f.enabled).length} of {p.features.length}</dd></div>
              </dl>
              <ul className="mt-4 flex-1 space-y-3 text-sm">
                {SECTIONS.map((sec) => {
                  const inc = p.features.filter((f) => f.enabled && f.section === sec && !f.key.startsWith('NEW_LISTING_'));
                  if (!inc.length) return null;
                  return (
                    <li key={sec}>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">{SECTION_LABEL[sec]}</p>
                      <ul className="mt-1 space-y-1">
                        {inc.map((f) => <li key={f.key} className="flex gap-2"><span className="text-emerald-700" aria-hidden>✓</span><span>{f.key === 'CALL_SUPPORT' && call ? `Call support (${human(call).toLowerCase()})` : f.label}</span></li>)}
                      </ul>
                    </li>
                  );
                })}
              </ul>
              <button className={`${isSel ? 'btn-primary' : popular ? 'btn-gold' : 'btn-ghost'} mt-6 w-full`} onClick={() => setSelected(p.code)} aria-pressed={isSel}>
                {isSel ? `${p.name} selected ✓` : `Select ${p.name}`}
              </button>
            </section>
          );
        })}
      </div>

      {plan && (
        <section id="activate" className="mx-auto max-w-3xl space-y-4" aria-label="Activate your plan">
          <h2 className="font-display text-2xl">Activate {plan.name}</h2>
          <BillingProfileForm billing={billing} onSaved={(m) => onDone(m)} />
          <div className="card p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm"><span>{plan.name} plan · 1 month</span><span>{inrExact(plan.pricePaise)}</span></div>
            {billing.profileComplete && billing.gst.supplierState ? (
              <>
                <div className="mt-1 flex justify-between text-sm text-ink-3"><span>{gstTotal(plan.pricePaise, billing).label}</span><span>{inrExact(gstTotal(plan.pricePaise, billing).total - plan.pricePaise)}</span></div>
                <p className="mt-3 flex justify-between border-t border-ink/10 pt-3 font-semibold" data-testid={`total-${plan.code}`}><span>Payable</span><span>{inrExact(gstTotal(plan.pricePaise, billing).total)}</span></p>
              </>
            ) : <p className="mt-2 text-xs text-ink-3">Save your billing details above to see GST and the total.</p>}
            {!billing.paymentsConfigured && (
              <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">Online payments are not configured yet. To start now, write to <a className="underline" href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a> and we will activate your plan.</p>
            )}
            <button className="btn-primary mt-4 w-full" disabled={!billing.paymentsConfigured || !billing.profileComplete || busy !== null} onClick={() => startCheckout(plan.code, onDone, setBusy)}>
              {busy === plan.code ? 'Opening checkout…' : `Pay & activate ${plan.name}`}
            </button>
            {billing.previewActivation && (
              <div className="mt-4 rounded-xl border border-dashed border-amber-400 p-4">
                <p className="text-xs text-amber-900">Test environment only: activate this plan without payment to try the plan dashboard. No payment or invoice is created.</p>
                <button className="btn-ghost mt-3 w-full" disabled={busy !== null} onClick={() => previewActivate(plan.code)}>{busy === plan.code ? 'Activating…' : `Activate ${plan.name} for testing (no payment)`}</button>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className={`card p-5 ${highlight ? 'ring-2 ring-sun' : ''}`}>
      <p className="label">{label}</p>
      <p className="font-display text-2xl">{value}</p>
      {sub && <p className="mt-1 text-xs text-ink-3">{sub}</p>}
    </div>
  );
}

function Requests({ requests, onNew }: { requests: Req[]; onNew: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [update, setUpdate] = useState<Record<string, string>>({});
  async function toggle(id: string) {
    setOpen(open === id ? null : id);
    if (!update[id]) {
      const r = await api<{ update: { text: string } }>(`/requests/${id}`);
      setUpdate((u) => ({ ...u, [id]: r.update.text }));
    }
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between"><h1 className="font-display text-3xl">Requests</h1><button className="btn-primary" onClick={onNew}>New request</button></div>
      {requests.map((r) => (
        <div key={r.id} className="card">
          <button className="flex w-full flex-wrap items-center justify-between gap-3 p-5 text-left" onClick={() => toggle(r.id)} aria-expanded={open === r.id}>
            <div>
              <p className="font-semibold">{r.title}</p>
              <p className="text-xs text-ink-3">{human(r.featureKey)}{r.marketplace ? ` · ${human(r.marketplace)}` : ''} · {new Date(r.createdAt).toLocaleDateString('en-IN')}</p>
            </div>
            <Status s={r.status} />
          </button>
          {open === r.id && (
            <div className="border-t border-ink/10 p-5">
              {r.tasks.length > 0 && (
                <ol className="mb-5 space-y-2">
                  {r.tasks.map((t, i) => (
                    <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span><span className="mr-2 text-ink-3">{i + 1}.</span>{t.title}</span><Status s={t.status} />
                    </li>
                  ))}
                </ol>
              )}
              <div className="rounded-xl bg-ivory p-4">{update[r.id] ? <Markdownish text={update[r.id]} /> : 'Loading…'}</div>
            </div>
          )}
        </div>
      ))}
      {!requests.length && <p className="card p-6 text-sm text-ink-3">No requests yet. Open Services to raise your first request.</p>}
    </div>
  );
}

const MARKETPLACE_FIXED: Record<string, string> = { NEW_LISTING_AMAZON: 'AMAZON', NEW_LISTING_FLIPKART: 'FLIPKART' };

function RequestModal({ feature, onClose, onCreated }: { feature: Feature; onClose: () => void; onCreated: (msg: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fixed = MARKETPLACE_FIXED[feature.key];
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError(null);
    const f = new FormData(e.currentTarget);
    try {
      const res = await api<{ request: { status: string } }>('/requests', {
        method: 'POST',
        body: {
          featureKey: feature.key, title: f.get('title'), marketplace: fixed ?? (f.get('marketplace') || undefined), priority: f.get('priority'),
          details: { notes: f.get('notes'), ...(f.get('includeCaPack') ? { includeCaPack: true } : {}) },
        },
      });
      onCreated(res.request.status === 'QUEUED' ? 'Request received. Your manager has been notified.' : 'Request recorded. See the request for what happens next.');
    } catch (err) { setError((err as Error).message); setBusy(false); }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center" role="dialog" aria-modal aria-labelledby="req-title">
      <form onSubmit={submit} className="card w-full max-w-lg space-y-4 p-6">
        <h2 id="req-title" className="font-display text-xl">Request: {feature.label}</h2>
        <div><label className="label" htmlFor="title">What do you need?</label><input id="title" name="title" className="input" required minLength={3} placeholder="e.g. List our new jute table runner" /></div>
        {!fixed && <div><label className="label" htmlFor="marketplace">Marketplace</label>
          <select id="marketplace" name="marketplace" className="input"><option value="">Both / not specific</option><option value="AMAZON">Amazon</option><option value="FLIPKART">Flipkart</option></select></div>}
        <div><label className="label" htmlFor="priority">Urgency</label>
          <select id="priority" name="priority" className="input" defaultValue="P3"><option value="P1">Critical: business stopped</option><option value="P2">High</option><option value="P3">Normal</option><option value="P4">Low</option></select></div>
        <div><label className="label" htmlFor="notes">Details</label><textarea id="notes" name="notes" className="input min-h-24" placeholder="SKUs, links, deadlines…" /></div>
        {(feature.key === 'MONTHLY_PERFORMANCE_REPORT' || feature.key === 'MONTHLY_PL_REPORT') && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="includeCaPack" /> Also prepare the CA documentation pack</label>}
        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Submit request'}</button></div>
      </form>
    </div>
  );
}

function BillingTab({ billing, plans, current, preselect, onDone }: { billing: Billing; plans: Plan[]; current?: string; preselect: string | null; onDone: (m: { kind: 'ok' | 'err'; text: string }) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const sorted = useMemo(() => plans, [plans]);

  const choose = (code: string) => startCheckout(code, onDone, setBusy);

  return (
    <div className="space-y-8">
      <h1 className="font-display text-3xl">Billing</h1>
      {!billing.paymentsConfigured && <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">Online payments are not configured yet. Please contact SOLLUNA to activate your plan.</p>}
      <BillingProfileForm billing={billing} onSaved={(m) => onDone(m)} />
      <div className="grid gap-4 md:grid-cols-3">
        {sorted.map((p) => (
          <div key={p.code} className={`card p-6 ${preselect === p.code ? 'ring-2 ring-sun' : ''}`}>
            <p className="label">{p.name}</p>
            <p className="font-display text-3xl">{inr(p.pricePaise)}<span className="font-sans text-sm text-ink-3"> /month + GST</span></p>
            <p className="mt-1 text-xs text-ink-3">{p.features.filter((f) => f.enabled).length} of {p.features.length} services</p>
            {billing.profileComplete && billing.gst.supplierState && (
              <p className="mt-3 rounded-lg bg-ivory px-3 py-2 text-xs text-ink-2" data-testid={`total-${p.code}`}>
                Payable <strong>{inrExact(gstTotal(p.pricePaise, billing).total)}</strong> incl. {gstTotal(p.pricePaise, billing).label}
              </p>
            )}
            <button className="btn-primary mt-5 w-full" disabled={!billing.paymentsConfigured || !billing.profileComplete || busy !== null} onClick={() => choose(p.code)}>
              {busy === p.code ? 'Opening checkout…' : current === p.code ? 'Renew' : current ? `Switch to ${p.name}` : `Choose ${p.name}`}
            </button>
          </div>
        ))}
      </div>
      <CancelPlan billing={billing} onDone={onDone} />
      <section className="card overflow-x-auto p-6">
        <h2 className="font-semibold">Payments</h2>
        <table className="mt-3 w-full min-w-[480px] text-sm">
          <tbody>
            {billing.payments.map((p) => (
              <tr key={p.id} className="border-t border-ink/5"><td className="py-2">{new Date(p.createdAt).toLocaleString('en-IN')}</td><td>{inrExact(p.amountPaise)}</td><td><Status s={p.status} /></td><td className="text-xs text-ink-3">{p.failureReason}</td></tr>
            ))}
            {!billing.payments.length && <tr><td className="py-2 text-ink-3">No payments yet.</td></tr>}
          </tbody>
        </table>
      </section>
      <section className="card overflow-x-auto p-6">
        <h2 className="font-semibold">Invoices</h2>
        <table className="mt-3 w-full min-w-[480px] text-sm">
          <tbody>
            {billing.invoices.map((i) => (
              <tr key={i.id} className="border-t border-ink/5">
                <td className="py-2 font-medium">{i.number}</td><td>{new Date(i.issuedAt).toLocaleDateString('en-IN')}</td>
                <td>{inrExact(i.amountPaise)}</td><td className="text-ink-3">GST {inrExact(i.gstPaise)}</td>
                <td className="text-right"><Link className="font-semibold underline" href={`/invoices/${i.id}`}>View tax invoice</Link></td>
              </tr>
            ))}
            {!billing.invoices.length && <tr><td className="py-2 text-ink-3">No invoices yet.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}

const inrExact = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Mirrors the server's GST calculation (apps/api/src/billing/gst.ts) for the pre-checkout total. */
function gstTotal(taxable: number, b: Billing) {
  const intra = b.gst.supplierState === b.profile.stateCode;
  const half = Math.round((taxable * b.gst.rateBps) / 2 / 10_000);
  const tax = intra ? half * 2 : Math.round((taxable * b.gst.rateBps) / 10_000);
  const pct = b.gst.rateBps / 100;
  return { total: taxable + tax, label: intra ? `CGST ${pct / 2}% + SGST ${pct / 2}%` : `IGST ${pct}%` };
}

function BillingProfileForm({ billing, onSaved }: { billing: Billing; onSaved: (m: { kind: 'ok' | 'err'; text: string }) => void }) {
  const p = billing.profile;
  const [editing, setEditing] = useState(!billing.profileComplete);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!editing) {
    return (
      <section className="card flex flex-wrap items-start justify-between gap-4 p-6">
        <div className="text-sm">
          <p className="label">Billed to (on your GST invoice)</p>
          <p className="font-semibold">{p.legalName}</p>
          <p className="text-ink-3">{p.address}, {p.city} {p.pincode} · {billing.states[p.stateCode ?? '']}</p>
          <p className="text-ink-3">{p.gstin ? `GSTIN ${p.gstin}` : 'Unregistered (no GSTIN)'}</p>
        </div>
        <button className="btn-ghost py-1.5 text-xs" onClick={() => setEditing(true)}>Edit billing details</button>
      </section>
    );
  }
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = Object.fromEntries([...f.entries()].map(([k, v]) => [k, String(v).trim()]).filter(([, v]) => v !== ''));
    setBusy(true); setError(null);
    try {
      await api('/billing/profile', { method: 'PATCH', body });
      setEditing(false);
      onSaved({ kind: 'ok', text: 'Billing details saved.' });
    } catch (err) {
      const e = err as ApiError;
      setError(e.issues?.length ? e.issues.map((i) => i.message).join(' · ') : e.message);
    }
    setBusy(false);
  }
  return (
    <form onSubmit={save} className="card space-y-4 p-6" aria-label="Billing details">
      <div><h2 className="font-semibold">Billing details for your GST invoice</h2><p className="text-xs text-ink-3">Add your GSTIN to claim input tax credit. Without a GSTIN, select your state; it decides CGST + SGST or IGST.</p></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="label" htmlFor="gstin">GSTIN (optional)</label><input id="gstin" name="gstin" className="input uppercase" defaultValue={p.gstin ?? ''} placeholder="24ABCDE1234F1Z6" /></div>
        <div><label className="label" htmlFor="stateCode">State</label>
          <select id="stateCode" name="stateCode" className="input" defaultValue={p.stateCode ?? ''}>
            <option value="">Select state</option>
            {Object.entries(billing.states).sort(([a], [b]) => a.localeCompare(b)).map(([c, n]) => <option key={c} value={c}>{c} · {n}</option>)}
          </select></div>
        <div className="sm:col-span-2"><label className="label" htmlFor="address">Billing address</label><input id="address" name="address" className="input" required defaultValue={p.address ?? ''} /></div>
        <div><label className="label" htmlFor="city">City</label><input id="city" name="city" className="input" required defaultValue={p.city ?? ''} /></div>
        <div><label className="label" htmlFor="pincode">PIN code</label><input id="pincode" name="pincode" className="input" required inputMode="numeric" defaultValue={p.pincode ?? ''} /></div>
      </div>
      {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      <div className="flex gap-2"><button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save billing details'}</button>{billing.profileComplete && <button type="button" className="btn-ghost" onClick={() => setEditing(false)}>Cancel</button>}</div>
    </form>
  );
}

function CancelPlan({ billing, onDone }: { billing: Billing; onDone: (m: { kind: 'ok' | 'err'; text: string }) => void }) {
  const sub = billing.subscriptions.find((x) => x.status === 'ACTIVE' || x.status === 'GRACE_PERIOD');
  const [confirming, setConfirming] = useState(false);
  if (!sub) return null;
  const end = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '';
  async function set(cancel: boolean, reason?: string) {
    try { await api('/billing/cancel', { method: 'POST', body: { cancel, reason } }); onDone({ kind: 'ok', text: cancel ? `Cancellation scheduled. ${sub!.plan.name} stays active until ${end}.` : 'Cancellation withdrawn. Your plan continues.' }); }
    catch (e) { onDone({ kind: 'err', text: (e as Error).message }); }
    setConfirming(false);
  }
  return (
    <section className="card flex flex-wrap items-center justify-between gap-3 p-6">
      <div className="text-sm">
        <p className="font-semibold">{sub.plan.name} plan · {sub.cancelAtPeriodEnd ? <span className="text-amber-800">ends {end}</span> : <>paid until {end}</>}</p>
        <p className="text-xs text-ink-3">{sub.cancelAtPeriodEnd ? 'Your plan will not renew. You keep access to reports, documents and chat history.' : 'Plans are paid monthly. Renew from the plan cards above before the date to avoid interruption.'}</p>
      </div>
      {sub.cancelAtPeriodEnd ? <button className="btn-ghost py-1.5 text-xs" onClick={() => set(false)}>Keep my plan</button> : confirming ? (
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); set(true, String(new FormData(e.currentTarget).get('reason') ?? '') || undefined); }}>
          <input name="reason" className="input py-1.5 text-xs" placeholder="Reason (optional)" aria-label="Cancellation reason" />
          <button className="btn-ghost py-1.5 text-xs text-red-800">Confirm cancel at period end</button>
          <button type="button" className="py-1.5 text-xs underline" onClick={() => setConfirming(false)}>Back</button>
        </form>
      ) : <button className="btn-ghost py-1.5 text-xs" onClick={() => setConfirming(true)}>Cancel at period end</button>}
    </section>
  );
}
