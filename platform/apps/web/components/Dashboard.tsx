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

interface Me { user: { id: string; name: string; email: string; type: string }; organization: { legalName: string; brandName: string | null } | null }
interface Feature { key: string; label: string; section: string; skill: string; enabled: boolean; limit: number | null; used: number | null; access: string; remaining: number | null; meta: { mode?: string } | null }
interface Catalog { plan: { code: string; name: string; status: string; currentPeriodEnd: string } | null; subscriptionVerified: boolean | null; features: Feature[] }
interface TaskLite { id: string; title: string; status: string; skill: string; stepKey: string; blocker: string | null }
interface Req { id: string; title: string; featureKey: string; status: string; entitlement: string; marketplace: string | null; createdAt: string; tasks: TaskLite[] }
interface Approval { id: string; actionType: string; parameters: Record<string, unknown>; status: string; createdAt: string; task: { title: string; requestId: string } | null }
interface BillingProfile { legalName: string; gstin: string | null; address: string | null; city: string | null; pincode: string | null; stateCode: string | null }
interface Billing {
  paymentsConfigured: boolean;
  profile: BillingProfile;
  profileComplete: boolean;
  gst: { rateBps: number; supplierState: string | null };
  states: Record<string, string>;
  subscriptions: { id: string; status: string; currentPeriodEnd: string | null; plan: { code: string; name: string; pricePaise: number } }[];
  payments: { id: string; amountPaise: number; status: string; failureReason: string | null; createdAt: string }[];
  invoices: { id: string; number: string; amountPaise: number; taxablePaise: number; gstPaise: number; issuedAt: string }[];
}
interface Plan { code: string; name: string; pricePaise: number; features: { enabled: boolean }[] }
interface Notification { id: string; title: string; body: string; createdAt: string; readAt: string | null }

const TABS = ['overview', 'services', 'requests', 'approvals', 'chat', 'reports', 'documents', 'billing'] as const;
type Tab = (typeof TABS)[number];

const STATUS_STYLE: Record<string, string> = {
  COMPLETED: 'bg-emerald-50 text-emerald-800', PARTIALLY_COMPLETED: 'bg-amber-50 text-amber-800', CANCELLED: 'bg-ink/5 text-ink-3',
  BLOCKED: 'bg-red-50 text-red-800', AWAITING_CLIENT_APPROVAL: 'bg-sun/15 text-sun-3', AWAITING_INFORMATION: 'bg-sun/15 text-sun-3',
  PLAN_VERIFICATION: 'bg-moon/10 text-moon', IN_PROGRESS: 'bg-moon/10 text-moon', QUEUED: 'bg-ink/5 text-ink-2', NEW: 'bg-ink/5 text-ink-2',
  UNDER_MARKETPLACE_REVIEW: 'bg-moon/10 text-moon', ACTIVE: 'bg-emerald-50 text-emerald-800', GRACE_PERIOD: 'bg-amber-50 text-amber-800',
  VERIFIED: 'bg-emerald-50 text-emerald-800', FAILED: 'bg-red-50 text-red-800', INITIATED: 'bg-ink/5 text-ink-2', REQUESTED: 'bg-sun/15 text-sun-3',
  APPROVED: 'bg-emerald-50 text-emerald-800', DECLINED: 'bg-red-50 text-red-800',
};
const human = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
export const Status = ({ s }: { s: string }) => <span className={`chip ${STATUS_STYLE[s] ?? 'bg-ink/5 text-ink-2'}`}>{human(s)}</span>;

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

  const load = useCallback(async () => {
    try {
      const m = await api<Me>('/auth/me');
      if (m.user.type === 'STAFF') { router.replace('/ops'); return; }
      setMe(m);
      const [c, r, a, b, p, n] = await Promise.all([
        api<Catalog>('/features'), api<Req[]>('/requests'), api<Approval[]>('/approvals'), api<Billing>('/billing'), api<Plan[]>('/plans'), api<Notification[]>('/notifications'),
      ]);
      setCatalog(c); setRequests(r); setApprovals(a); setBilling(b); setPlans(p); setNotes(n);
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

  return (
    <div className="min-h-screen">
      <header className="border-b border-ink/10 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <Logo />
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-ink-3 sm:inline">{me.organization?.brandName ?? me.organization?.legalName}</span>
            <button className="btn-ghost py-1.5" onClick={logout}>Sign out</button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 sm:px-6" aria-label="Dashboard">
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`relative whitespace-nowrap px-3 py-3 text-sm font-medium capitalize ${tab === t ? 'text-ink' : 'text-ink-3 hover:text-ink'}`}>
              {t}{t === 'approvals' && pendingApprovals.length > 0 && <span className="ml-1.5 chip bg-sun text-ink">{pendingApprovals.length}</span>}
              {tab === t && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded bg-sun" />}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {flash && (
          <div role="status" className={`mb-6 rounded-xl px-4 py-3 text-sm ${flash.kind === 'ok' ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-900'}`}>
            {flash.text} <button className="ml-2 underline" onClick={() => setFlash(null)}>Dismiss</button>
          </div>
        )}

        {tab === 'overview' && (
          <div className="space-y-6">
            <h1 className="font-display text-3xl">Welcome, {me.user.name.split(' ')[0]}</h1>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Plan" value={catalog.plan ? catalog.plan.name : 'No active plan'} sub={catalog.plan ? `Renews ${new Date(catalog.plan.currentPeriodEnd).toLocaleDateString('en-IN')}` : catalog.subscriptionVerified === null ? 'Payment being verified' : 'Choose a plan to start'} />
              <Stat label="Services included" value={`${catalog.features.filter((f) => f.access === 'ALLOWED' || f.access === 'LIMIT_REACHED').length} / 28`} />
              <Stat label="Open requests" value={String(openRequests.length)} />
              <Stat label="Awaiting your approval" value={String(pendingApprovals.length)} highlight={pendingApprovals.length > 0} />
            </div>
            {!catalog.plan && <div className="card flex flex-wrap items-center justify-between gap-4 p-6"><p>Activate a plan to start submitting requests.</p><button className="btn-gold" onClick={() => setTab('billing')}>View plans</button></div>}
            {catalog.plan && (
              <div className="grid gap-4 md:grid-cols-2">
                {['NEW_LISTING_AMAZON', 'NEW_LISTING_FLIPKART'].map((k) => {
                  const f = catalog.features.find((x) => x.key === k)!;
                  return <Stat key={k} label={`${f.label.replace(' / Month', '')} this billing month`} value={f.limit === null ? `${f.used ?? 0} used · Unlimited` : `${f.used ?? 0} of ${f.limit} used`} />;
                })}
              </div>
            )}
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

        {tab === 'services' && (
          <div className="space-y-8">
            <div><h1 className="font-display text-3xl">Services</h1><p className="mt-1 text-sm text-ink-3">Each service is delivered by a SOLLUNA specialist following a documented operating procedure.</p></div>
            {SECTIONS.map((s) => (
              <section key={s}>
                <h2 className="label">{SECTION_LABEL[s]}</h2>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {catalog.features.filter((f) => f.section === s).map((f) => (
                    <div key={f.key} className={`card flex flex-col p-5 ${f.access === 'ALLOWED' ? '' : 'opacity-70'}`}>
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-sm font-semibold">{f.label}</h3>
                        {f.access === 'ALLOWED' ? <span className="chip bg-emerald-50 text-emerald-800">Included</span> : f.access === 'LIMIT_REACHED' ? <span className="chip bg-amber-50 text-amber-800">Limit used</span> : <span className="chip bg-ink/5 text-ink-3">Not in plan</span>}
                      </div>
                      {f.limit !== null && f.enabled && <p className="mt-1 text-xs text-ink-3">{f.used ?? 0} of {f.limit} used this month</p>}
                      {f.meta?.mode && <p className="mt-1 text-xs text-ink-3">{human(f.meta.mode)}</p>}
                      <button className="btn-ghost mt-4 self-start py-1.5 text-xs" disabled={!catalog.plan} onClick={() => setRequestFor(f)}>Request</button>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        {tab === 'requests' && <Requests requests={requests} onNew={() => setTab('services')} />}

        {tab === 'approvals' && (
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

        {tab === 'chat' && <ChatPanel mode="client" />}

        {tab === 'reports' && <ClientReporting />}

        {tab === 'documents' && <div className="space-y-4"><h1 className="font-display text-3xl">Documents</h1><DocumentsPanel myId={me.user.id} /></div>}

        {tab === 'billing' && <BillingTab billing={billing} plans={plans} current={catalog.plan?.code} preselect={params.get('plan')} onDone={(m) => { setFlash(m); load(); }} />}
      </main>

      {requestFor && <RequestModal feature={requestFor} onClose={() => setRequestFor(null)} onCreated={(msg) => { setRequestFor(null); setFlash({ kind: 'ok', text: msg }); setTab('requests'); load(); }} />}
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

  async function choose(code: string) {
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
            onDone({ kind: 'ok', text: `Payment verified. Your ${order.plan.name} plan is active.` });
          } catch (e) { onDone({ kind: 'err', text: (e as Error).message }); }
          setBusy(null);
        },
        modal: { ondismiss: () => setBusy(null) },
      });
      rzp.on('payment.failed', () => { onDone({ kind: 'err', text: 'Payment failed. Your plan has not changed. Please try again.' }); setBusy(null); });
      rzp.open();
    } catch (e) { onDone({ kind: 'err', text: (e as Error).message }); setBusy(null); }
  }

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
