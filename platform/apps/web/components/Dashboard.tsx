'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError, inr, SECTIONS, SECTION_LABEL } from '@/lib/api';
import { loadRazorpay } from '@/lib/razorpay';
import Link from 'next/link';
import { Logo } from './Logo';
import { ChatPanel, DocumentsPanel } from './Chat';
import { ClientReporting } from './Reporting';
import { ClientCatalog } from './ClientCatalog';
import { ClientFulfilment } from './Fulfilment';
import { AccountSettings, type MeFull } from './Settings';

type Me = MeFull;
interface Feature { key: string; label: string; section: string; skill: string; enabled: boolean; limit: number | null; used: number | null; access: string; remaining: number | null; meta: { mode?: string } | null }
interface Catalog { plan: { code: string; name: string; status: string; currentPeriodEnd: string } | null; subscriptionVerified: boolean | null; features: Feature[] }
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
interface ChatSummary { managerPending: { assignBy: string } | null; managers: { id: string; name: string; staffRole: string }[]; messages: { id: string; body: string; senderType: string; createdAt: string; sender: { id: string; name: string } }[] }
interface Notification { id: string; title: string; body: string; createdAt: string; readAt: string | null }

/** Client navigation: five work areas. Settings, plan & billing and documents live in the account menu (top right). */
const TABS = ['chat', 'listings', 'labels', 'reports', 'notifications'] as const;
const MENU = ['settings', 'billing', 'documents'] as const;
type Tab = (typeof TABS)[number] | (typeof MENU)[number];
const ALL: readonly string[] = [...TABS, ...MENU];
/** Older links (?tab=overview, catalog, approvals …) still land somewhere sensible. */
const ALIAS: Record<string, Tab> = { overview: 'chat', services: 'chat', requests: 'notifications', approvals: 'notifications', tickets: 'notifications', inventory: 'notifications', catalog: 'listings' };
const TAB_LABEL: Record<Tab, string> = { chat: 'Manager Chat', listings: 'Listings & Mapping', labels: 'Labels', reports: 'Reports', notifications: 'Notifications', settings: 'Settings', billing: 'Plan & billing', documents: 'Documents' };
const toTab = (p: string | null): Tab => (p && ALL.includes(p) ? (p as Tab) : (p && ALIAS[p]) || 'chat');

export { Status, human } from './ui';
import { Status, human } from './ui';
import { CONTACT } from './Site';

export function Dashboard() {
  const router = useRouter();
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>(toTab(params.get('tab')));
  const [me, setMe] = useState<Me | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [billing, setBilling] = useState<Billing | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [chat, setChat] = useState<ChatSummary | null>(null);
  const [unread, setUnread] = useState(0);

  const refreshUnread = useCallback(() => api<{ count: number }>('/notifications/unread-count').then((r) => setUnread(r.count)).catch(() => undefined), []);
  const load = useCallback(async () => {
    try {
      const m = await api<Me>('/auth/me');
      if (m.user.type === 'STAFF') { router.replace('/ops'); return; }
      setMe(m);
      const [c, a, b, p] = await Promise.all([api<Catalog>('/features'), api<Approval[]>('/approvals'), api<Billing>('/billing'), api<Plan[]>('/plans')]);
      setCatalog(c); setApprovals(a); setBilling(b); setPlans(p);
      if (c.plan) setChat(await api<ChatSummary>('/chat').catch(() => null));
      refreshUnread();
    } catch (e) {
      if ((e as ApiError).status === 401) router.replace('/login');
      else setFlash({ kind: 'err', text: (e as Error).message });
    }
  }, [router, refreshUnread]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(refreshUnread, 60_000); return () => clearInterval(t); }, [refreshUnread]);

  const pendingApprovals = approvals.filter((a) => a.status === 'REQUESTED');

  async function logout() { await api('/auth/logout', { method: 'POST' }); router.replace('/login'); }

  if (!me || !catalog || !billing) {
    return <main className="flex min-h-screen items-center justify-center text-ink-3">{flash?.text ?? 'Loading your dashboard…'}</main>;
  }

  const hasPlan = Boolean(catalog.plan);
  const allowed = (k: string) => catalog.features.some((f) => f.key === k && (f.access === 'ALLOWED' || f.access === 'LIMIT_REACHED'));
  // Before the first plan: plans only. After a plan has lapsed: renew, plus read access to past reports and updates.
  const lapsed = !hasPlan && billing.subscriptions.some((x) => ['ACTIVE', 'GRACE_PERIOD', 'PAST_DUE', 'EXPIRED', 'CANCELLED'].includes(x.status) && x.currentPeriodEnd);
  const visible: Tab[] = hasPlan ? [...TABS] : lapsed ? ['reports', 'notifications'] : [];
  const menu: Tab[] = hasPlan || lapsed ? [...MENU] : [];
  const reachable = [...visible, ...menu];
  const current: Tab | null = reachable.includes(tab) ? tab : hasPlan ? 'chat' : null;
  const go = (t: Tab) => { setTab(t); window.history.replaceState(null, '', `?tab=${t}`); if (t === 'notifications') refreshUnread(); };
  const header = (
    <header className="border-b border-ink/10 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Logo />
        <AccountMenu name={me.organization?.brandName ?? me.organization?.legalName ?? me.user.name} items={menu} labels={TAB_LABEL} onPick={go} onLogout={logout} />
      </div>
      {visible.length > 0 && (
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 sm:px-6" aria-label="Dashboard">
          {visible.map((t) => (
            <button key={t} onClick={() => go(t)} aria-current={current === t ? 'page' : undefined} className={`relative whitespace-nowrap px-3 py-3 text-sm font-medium ${current === t ? 'text-ink' : 'text-ink-3 hover:text-ink'}`}>
              {TAB_LABEL[t]}
              {t === 'notifications' && unread + pendingApprovals.length > 0 && <span className="ml-1.5 chip bg-sun text-ink">{unread + pendingApprovals.length}</span>}
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

  if (!current) {
    return (
      <div className="min-h-screen">
        {header}
        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          {flashBox}
          <PlanPicker
            firstName={me.user.name.split(' ')[0]} billing={billing} plans={plans} preselect={params.get('plan')} lapsed={lapsed}
            verifying={catalog.subscriptionVerified === null}
            onDone={(m, activated) => { setFlash(m); if (activated) go('chat'); load(); }}
          />
        </main>
      </div>
    );
  }

  const manager = chat?.managers[0] ?? null;

  return (
    <div className="min-h-screen">
      {header}
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {flashBox}

        {current === 'chat' && (
          <div className="space-y-4">
            <section className="card flex flex-wrap items-center justify-between gap-4 p-5" aria-label="Your account manager">
              {manager ? (
                <div className="flex items-center gap-4">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ink font-display text-base text-sun-2" aria-hidden>{manager.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}</span>
                  <div><p className="label !mb-0">Your account manager</p><p className="font-display text-lg">{manager.name}</p><p className="text-xs text-ink-3">{human(manager.staffRole)} · Mon–Sat, 10 AM–7 PM IST</p></div>
                </div>
              ) : (
                <div>
                  <p className="label !mb-0">Your account manager</p>
                  <p className="font-display text-lg">Assigned within 1 hour</p>
                  <p className="text-xs text-ink-3">Your dedicated manager is being assigned{chat?.managerPending ? ` (by ${new Date(chat.managerPending.assignBy).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })})` : ''} and will message you here.</p>
                </div>
              )}
              {catalog.plan && <button className="chip bg-ivory px-3 py-1 text-ink-2" onClick={() => go('billing')}>{catalog.plan.name} plan · renews {new Date(catalog.plan.currentPeriodEnd).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</button>}
            </section>
            <ChatPanel mode="client" />
          </div>
        )}
        {current === 'listings' && <ClientCatalog />}
        {current === 'labels' && (allowed('SHIPPING_LABEL_GENERATION') || allowed('PERSONALIZED_THANK_YOU_NOTES') ? <ClientFulfilment /> : (
          <div className="space-y-4">
            <h1 className="font-display text-3xl">Labels</h1>
            <section className="card p-6" aria-label="Labels not in plan">
              <p className="font-semibold">Shipping labels are included from the Growth plan</p>
              <p className="mt-1 text-sm text-ink-3">On Growth, your manager generates your Amazon and Flipkart labels every day and you download print-ready files here.</p>
              <button className="btn-gold mt-4" onClick={() => go('billing')}>See plans</button>
            </section>
          </div>
        ))}
        {current === 'reports' && <div className="space-y-8">{hasPlan && <CaRequest onDone={setFlash} />}<ClientReporting /></div>}
        {current === 'notifications' && <NotificationsCenter approvals={pendingApprovals} onDecide={decide} onRead={refreshUnread} />}
        {current === 'settings' && <AccountSettings me={me} onDone={(m) => { setFlash(m); api<Me>('/auth/me').then(setMe).catch(() => undefined); }} />}
        {current === 'documents' && <div className="space-y-4"><h1 className="font-display text-3xl">Documents</h1><DocumentsPanel myId={me.user.id} /></div>}
        {current === 'billing' && <BillingTab billing={billing} plans={plans} current={catalog.plan?.code} preselect={params.get('plan')} onDone={(m) => { setFlash(m); load(); }} />}
      </main>
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

function AccountMenu({ name, items, labels, onPick, onLogout }: { name: string; items: Tab[]; labels: Record<Tab, string>; onPick: (t: Tab) => void; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [open]);
  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button className="btn-ghost gap-2 py-1.5" aria-haspopup="menu" aria-expanded={open} aria-label="Account menu" onClick={() => setOpen(!open)}>
        <span className="max-w-[40vw] truncate">{name}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-2 w-52 overflow-hidden rounded-2xl border border-ink/10 bg-white py-1 shadow-xl">
          {items.map((t) => <button key={t} role="menuitem" className="block w-full px-4 py-2.5 text-left text-sm hover:bg-ivory" onClick={() => { setOpen(false); onPick(t); }}>{labels[t]}</button>)}
          <button role="menuitem" className="block w-full border-t border-ink/10 px-4 py-2.5 text-left text-sm hover:bg-ivory" onClick={onLogout}>Sign out</button>
        </div>
      )}
    </div>
  );
}

const NOTE_GROUPS: [string, string, (type: string) => boolean][] = [
  ['all', 'All', () => true],
  ['tickets', 'Tickets', (t) => t.startsWith('ticket.')],
  ['work', 'Ads, promotions & requests', (t) => /^(request|task|approval)\./.test(t)],
  ['listings', 'Listings', (t) => /^(listing|mapping|marketplace)\./.test(t)],
  ['labels', 'Labels & stock', (t) => /^(labels|stock|thank_you)\./.test(t)],
  ['account', 'Plan & account', (t) => /^(subscription|payment|manager|chat|report|announcement|account)\./.test(t)],
];

function NotificationsCenter({ approvals, onDecide, onRead }: { approvals: Approval[]; onDecide: (id: string, d: 'APPROVED' | 'DECLINED') => void; onRead: () => void }) {
  const [items, setItems] = useState<(Notification & { type: string })[] | null>(null);
  const [group, setGroup] = useState('all');
  const load = useCallback(() => api<(Notification & { type: string })[]>('/notifications').then(setItems).catch(() => setItems([])), []);
  useEffect(() => { load(); }, [load]);
  const test = NOTE_GROUPS.find((g) => g[0] === group)![2];
  const shown = (items ?? []).filter((n) => test(n.type));
  async function readAll() { await api('/notifications/read-all', { method: 'POST' }); await load(); onRead(); }
  async function readOne(n: Notification) { if (n.readAt) return; await api(`/notifications/${n.id}/read`, { method: 'POST' }); await load(); onRead(); }
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="font-display text-3xl">Notifications</h1><p className="mt-1 text-sm text-ink-3">Updates on your tickets, ads, promotions, listings and labels.</p></div>
        {(items ?? []).some((n) => !n.readAt) && <button className="btn-ghost py-1.5 text-xs" onClick={readAll}>Mark all read</button>}
      </div>
      {approvals.length > 0 && (
        <section className="space-y-3" aria-label="Needs your approval">
          <h2 className="label">Needs your approval</h2>
          {approvals.map((a) => (
            <div key={a.id} className="card p-5 ring-2 ring-sun">
              <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{a.task?.title ?? human(a.actionType)}</h3><span className="text-xs uppercase tracking-wider text-ink-3">{human(a.actionType)}</span></div>
              <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                {Object.entries(a.parameters).map(([k, v]) => <div key={k} className="flex justify-between gap-3 border-b border-ink/5 py-1"><dt className="text-ink-3">{human(k.replace(/([a-z])([A-Z])/g, '$1_$2')).replace(/ inr$/, ' (₹)')}</dt><dd className="font-medium">{String(v)}</dd></div>)}
              </dl>
              <p className="mt-3 text-xs text-ink-3">Nothing is spent or changed until you approve.</p>
              <div className="mt-3 flex gap-2"><button className="btn-primary" onClick={() => onDecide(a.id, 'APPROVED')}>Approve</button><button className="btn-ghost" onClick={() => onDecide(a.id, 'DECLINED')}>Decline</button></div>
            </div>
          ))}
        </section>
      )}
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Filter notifications">
        {NOTE_GROUPS.map(([k, label]) => <button key={k} role="tab" aria-selected={group === k} className={group === k ? 'btn-primary py-1.5 text-xs' : 'btn-ghost py-1.5 text-xs'} onClick={() => setGroup(k)}>{label}</button>)}
      </div>
      <ul className="card divide-y divide-ink/5">
        {shown.map((n) => (
          <li key={n.id}>
            <button className="flex w-full gap-3 p-4 text-left hover:bg-ivory" onClick={() => readOne(n)}>
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.readAt ? 'bg-transparent' : 'bg-sun'}`} aria-label={n.readAt ? undefined : 'Unread'} />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline justify-between gap-2"><span className={`text-sm ${n.readAt ? '' : 'font-semibold'}`}>{n.title}</span><span className="text-xs text-ink-3">{new Date(n.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span></span>
                <span className="mt-0.5 block whitespace-pre-line text-xs text-ink-3">{n.body.replace(/\*\*/g, '')}</span>
              </span>
            </button>
          </li>
        ))}
        {items && !shown.length && <li className="p-4 text-sm text-ink-3">No updates here yet.</li>}
        {!items && <li className="p-4 text-sm text-ink-3">Loading…</li>}
      </ul>
    </div>
  );
}

/** Asks SOLLUNA to prepare the month's CA documentation pack and share it with the client's Chartered Accountant. */
function CaRequest({ onDone }: { onDone: (m: { kind: 'ok' | 'err'; text: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const last = new Date(); last.setMonth(last.getMonth() - 1);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const period = String(f.get('caPeriod'));
    const month = new Date(`${period}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    setBusy(true);
    try {
      await api('/requests', { method: 'POST', body: { featureKey: 'CA_DOCUMENTATION', title: `Send ${month} documents to my CA`, priority: 'P3', details: { period, caName: f.get('caName') || undefined, caEmail: f.get('caEmail') || undefined, notes: f.get('caNotes') || undefined } } });
      onDone({ kind: 'ok', text: `Request sent. Your manager will prepare the ${month} CA pack and share it with your CA.` });
      setOpen(false);
    } catch (err) { onDone({ kind: 'err', text: (err as Error).message }); }
    setBusy(false);
  }
  return (
    <section className="card p-6" aria-label="Send to my CA">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="font-semibold">Send reports to your CA</h2><p className="text-xs text-ink-3">We prepare the month&apos;s reports, settlements and invoices as one pack for your Chartered Accountant.</p></div>
        {!open && <button className="btn-gold" onClick={() => setOpen(true)}>Request CA pack</button>}
      </div>
      {open && (
        <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-2">
          <div><label className="label" htmlFor="caPeriod">Month</label><input id="caPeriod" name="caPeriod" type="month" className="input" required defaultValue={last.toISOString().slice(0, 7)} max={new Date().toISOString().slice(0, 7)} /></div>
          <div><label className="label" htmlFor="caName">CA name (optional)</label><input id="caName" name="caName" className="input" /></div>
          <div><label className="label" htmlFor="caEmail">CA email (optional)</label><input id="caEmail" name="caEmail" type="email" className="input" placeholder="ca@firm.in" /></div>
          <div><label className="label" htmlFor="caNotes">Anything specific?</label><input id="caNotes" name="caNotes" className="input" placeholder="e.g. GSTR-1 filing this week" /></div>
          <div className="flex gap-2 sm:col-span-2"><button className="btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send request'}</button><button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button></div>
        </form>
      )}
    </section>
  );
}

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
      onDone({ kind: 'ok', text: `${r.plan.name} plan activated for testing (no payment). Your dedicated manager will be assigned within 1 hour.` }, true);
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
