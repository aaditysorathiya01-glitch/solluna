'use client';
import { useState } from 'react';
import Link from 'next/link';
import { api, inr, SECTION_LABEL } from '@/lib/api';
import { Empty, Flash, Modal, Status, SubTabs, d, dt, errText, formBody, human, inrExact, useApi, type FlashMsg } from './ui';

interface Overview { clients: number; activeSubscriptions: number; byPlan: Record<string, number>; grace: number; pastDue: number; mrrPaise: number; revenue30: { taxablePaise: number; collectedPaise: number; payments: number }; failedPayments30: number; openTickets: number; overdueP1: number; openTasks: number; blockedTasks: number; newInquiries: number; staff: number }
interface Client { id: string; name: string; legalName: string; gstin: string | null; contactEmail: string; contactPhone: string; isSuspended: boolean; suspendedReason: string | null; onboardedAt: string | null; createdAt: string; plan: { name: string; code: string; status: string; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean } | null; managers: { id: string; name: string; staffRole: string }[]; openTickets: number; openTasks: number }
interface Staff { id: string; name: string; email: string; staffRole: string; isActive: boolean; twoFactorEnabled: boolean; lastLoginAt: string | null; clients: number; openTasks: number; openTickets: number }
interface PlanRow { code: string; name: string; pricePaise: number; isActive: boolean; activeSubscriptions: number; features: { key: string; label: string; section: string; enabled: boolean; limitValue: number | null; metered: boolean }[] }
interface Payment { id: string; amountPaise: number; taxablePaise: number; taxPaise: number; status: string; failureReason: string | null; createdAt: string; verifiedAt: string | null; razorpayOrderId: string | null; razorpayPaymentId: string | null; organization: { legalName: string; brandName: string | null }; invoice: { id: string; number: string } | null }
interface Audit { id: string; action: string; entity: string; entityId: string | null; actorType: string; organizationId: string | null; createdAt: string; ip: string | null; before: unknown; after: unknown; actor: { name: string; email: string; staffRole: string | null } | null }
interface Inquiry { id: string; name: string; email: string; phone: string | null; business: string | null; topic: string; message: string; status: string; createdAt: string }

const ROLES = ['SUPER_ADMIN', 'OPERATIONS_MANAGER', 'LISTING_EXECUTIVE', 'ADS_MANAGER', 'SUPPORT_EXECUTIVE', 'ACCOUNTS_EXECUTIVE'];

export function AdminConsole({ role }: { role: string }) {
  const superAdmin = role === 'SUPER_ADMIN';
  const tabs = [['overview', 'Overview'], ['clients', 'Clients'], ['team', 'Team'], ['plans', 'Plans'], ['payments', 'Payments'], ['manager-cost', 'Manager cost'], ['inquiries', 'Enquiries'], ['announce', 'Announcements'], ...(superAdmin ? [['audit', 'Audit log'] as const] : [])] as const;
  const [tab, setTab] = useState<string>('overview');
  const [flash, setFlash] = useState<FlashMsg>(null);
  return (
    <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6">
      <h1 className="font-display text-2xl">Admin</h1>
      <SubTabs tabs={tabs as unknown as readonly (readonly [string, string])[]} value={tab} onChange={setTab} />
      <Flash msg={flash} onClose={() => setFlash(null)} />
      {tab === 'overview' && <OverviewPanel />}
      {tab === 'clients' && <ClientsPanel onFlash={setFlash} />}
      {tab === 'team' && <TeamPanel superAdmin={superAdmin} onFlash={setFlash} />}
      {tab === 'plans' && <PlansPanel superAdmin={superAdmin} onFlash={setFlash} />}
      {tab === 'payments' && <PaymentsPanel />}
      {tab === 'manager-cost' && <ManagerCostPanel />}
      {tab === 'inquiries' && <InquiriesPanel onFlash={setFlash} />}
      {tab === 'announce' && <AnnouncePanel onFlash={setFlash} />}
      {tab === 'audit' && superAdmin && <AuditPanel />}
    </main>
  );
}

function Kpi({ label, value, sub, alert }: { label: string; value: string | number; sub?: string; alert?: boolean }) {
  return <div className={`card p-5 ${alert ? 'ring-2 ring-red-300' : ''}`}><p className="label">{label}</p><p className="font-display text-3xl">{value}</p>{sub && <p className="mt-1 text-xs text-ink-3">{sub}</p>}</div>;
}

function OverviewPanel() {
  const o = useApi<Overview>('/admin/overview');
  if (!o.data) return <Empty>{o.error ?? 'Loading…'}</Empty>;
  const x = o.data;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="MRR (excl. GST)" value={inr(x.mrrPaise)} sub={`${x.activeSubscriptions} active · ${Object.entries(x.byPlan).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none'}`} />
        <Kpi label="Collected, last 30 days" value={inr(x.revenue30.collectedPaise)} sub={`${x.revenue30.payments} payments · ${inr(x.revenue30.taxablePaise)} taxable`} />
        <Kpi label="Clients" value={x.clients} sub={`${x.grace} in grace · ${x.pastDue} past due`} alert={x.pastDue > 0} />
        <Kpi label="Failed payments (30 d)" value={x.failedPayments30} alert={x.failedPayments30 > 0} />
        <Kpi label="Open tickets" value={x.openTickets} sub={x.overdueP1 ? `${x.overdueP1} P1 past 30 min` : 'No P1 overdue'} alert={x.overdueP1 > 0} />
        <Kpi label="Open tasks" value={x.openTasks} sub={`${x.blockedTasks} blocked`} alert={x.blockedTasks > 0} />
        <Kpi label="New enquiries" value={x.newInquiries} alert={x.newInquiries > 0} />
        <Kpi label="Active staff" value={x.staff} />
      </div>
      <button className="btn-ghost py-1.5 text-xs" onClick={o.reload}>Refresh</button>
      <AmazonCheck />
    </div>
  );
}

function ClientsPanel({ onFlash }: { onFlash: (m: FlashMsg) => void }) {
  const list = useApi<Client[]>('/admin/client-list');
  const staff = useApi<{ id: string; name: string; staffRole: string }[]>('/admin/staff');
  const [q, setQ] = useState('');
  const [detail, setDetail] = useState<string | null>(null);
  const rows = (list.data ?? []).filter((c) => !q || `${c.name} ${c.legalName} ${c.contactEmail} ${c.gstin ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="space-y-3">
      <input className="input max-w-sm" placeholder="Search name, email, GSTIN" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search clients" />
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead><tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wider text-ink-3"><th className="p-3">Client</th><th>Plan</th><th>Renews / ends</th><th>Manager</th><th>Open</th><th>Status</th><th /></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="border-t border-ink/5">
                <td className="p-3"><p className="font-medium">{c.name}</p><p className="text-xs text-ink-3">{c.contactEmail}{c.gstin ? ` · ${c.gstin}` : ''}</p></td>
                <td>{c.plan ? <><span className="font-medium">{c.plan.name}</span> <Status s={c.plan.status} /></> : <span className="text-ink-3">—</span>}</td>
                <td className="text-xs">{c.plan?.currentPeriodEnd ? `${d(c.plan.currentPeriodEnd)}${c.plan.cancelAtPeriodEnd ? ' (cancelling)' : ''}` : '—'}</td>
                <td className="text-xs">{c.managers.map((m) => m.name).join(', ') || <span className="text-amber-800">Unassigned</span>}</td>
                <td className="text-xs">{c.openTasks} tasks · {c.openTickets} tickets</td>
                <td>{c.isSuspended ? <Status s="BLOCKED" label="Suspended" /> : c.onboardedAt ? <Status s="ACTIVE" label="Onboarded" /> : <Status s="PENDING" label="Onboarding" />}</td>
                <td className="p-3 text-right"><button className="btn-ghost py-1 text-xs" onClick={() => setDetail(c.id)}>Manage</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {detail && <ClientDetail id={detail} staff={staff.data ?? []} onClose={() => { setDetail(null); list.reload(); }} onFlash={onFlash} />}
    </div>
  );
}

interface ClientFull {
  id: string; legalName: string; brandName: string | null; gstin: string | null; isSuspended: boolean; suspendedReason: string | null; address: string | null; city: string | null; pincode: string | null;
  users: { id: string; name: string; email: string; phone: string | null; isActive: boolean; emailVerified: string | null; lastLoginAt: string | null }[];
  subscriptions: { id: string; status: string; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; plan: { name: string } }[];
  payments: { id: string; amountPaise: number; status: string; createdAt: string; failureReason: string | null }[];
  invoices: { id: string; number: string; amountPaise: number; issuedAt: string }[];
  managerAssignments: { manager: { id: string; name: string } }[];
  onboarding: { complete: boolean; steps: { key: string; label: string; done: boolean }[] };
  marketplaces: { marketplace: string; status: string; storeName: string | null }[];
}

function ClientDetail({ id, staff, onClose, onFlash }: { id: string; staff: { id: string; name: string; staffRole: string }[]; onClose: () => void; onFlash: (m: FlashMsg) => void }) {
  const c = useApi<ClientFull>(`/admin/clients/${id}/detail`);
  const [error, setError] = useState<string | null>(null);
  async function act(fn: () => Promise<unknown>, ok: string) {
    setError(null);
    try { await fn(); onFlash({ kind: 'ok', text: ok }); c.reload(); } catch (e) { setError(errText(e)); }
  }
  if (!c.data) return <Modal title="Client" onClose={onClose}><p className="text-sm text-ink-3">{c.error ?? 'Loading…'}</p></Modal>;
  const x = c.data;
  return (
    <Modal title={x.brandName ?? x.legalName} onClose={onClose}>
      <div className="space-y-5 text-sm">
        <div className="grid gap-4 sm:grid-cols-2">
          <div><p className="label">Business</p><p>{x.legalName}</p><p className="text-ink-3">{x.gstin ? `GSTIN ${x.gstin}` : 'No GSTIN'}</p><p className="text-ink-3">{[x.address, x.city, x.pincode].filter(Boolean).join(', ') || 'No billing address'}</p></div>
          <div><p className="label">Users</p>{x.users.map((u) => <p key={u.id}>{u.name} · {u.email} {u.emailVerified ? '✓' : <span className="text-amber-800">(unverified)</span>}<span className="block text-xs text-ink-3">last sign-in {dt(u.lastLoginAt)}</span></p>)}</div>
        </div>
        <div><p className="label">Onboarding</p><ul className="grid gap-1 sm:grid-cols-2">{x.onboarding.steps.map((s) => <li key={s.key} className={s.done ? 'text-ink-3' : ''}>{s.done ? '✓' : '○'} {s.label}</li>)}</ul></div>
        <div><p className="label">Marketplaces</p><div className="flex flex-wrap gap-3">{x.marketplaces.map((m) => <span key={m.marketplace}>{m.marketplace === 'AMAZON' ? 'Amazon' : 'Flipkart'}: <Status s={m.status} /> {m.storeName}</span>)}</div></div>
        <div>
          <p className="label">Manager</p>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const b = formBody(e.currentTarget); act(() => api(`/admin/clients/${id}/managers`, { method: 'POST', body: b }), 'Manager assigned.'); }}>
            <select name="managerId" className="input" defaultValue={x.managerAssignments[0]?.manager.id ?? ''} aria-label="Manager" required><option value="">Select</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name} · {human(s.staffRole)}</option>)}</select>
            <button className="btn-ghost whitespace-nowrap py-1.5 text-xs">Assign</button>
          </form>
        </div>
        <div><p className="label">Subscriptions</p>{x.subscriptions.map((s) => <p key={s.id}>{s.plan.name} <Status s={s.status} /> {s.currentPeriodEnd && `until ${d(s.currentPeriodEnd)}`}{s.cancelAtPeriodEnd && ' · cancelling'}</p>)}{!x.subscriptions.length && <p className="text-ink-3">None</p>}<p className="mt-1 text-xs text-ink-3">Plans activate only through a verified Razorpay payment.</p></div>
        <div><p className="label">Invoices</p>{x.invoices.map((i) => <p key={i.id}><Link className="underline" href={`/invoices/${i.id}?staff=1`} target="_blank">{i.number}</Link> · {inrExact(i.amountPaise)} · {d(i.issuedAt)}</p>)}{!x.invoices.length && <p className="text-ink-3">None</p>}</div>
        <div className="rounded-xl border border-red-200 p-4">
          <p className="label text-red-800">Access</p>
          {x.isSuspended ? (
            <div className="flex flex-wrap items-center justify-between gap-2"><p>Suspended: {x.suspendedReason}</p><button className="btn-primary py-1.5 text-xs" onClick={() => act(() => api(`/admin/clients/${id}/suspension`, { method: 'PATCH', body: { suspended: false } }), 'Client access restored.')}>Restore access</button></div>
          ) : (
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const b = formBody(e.currentTarget); act(() => api(`/admin/clients/${id}/suspension`, { method: 'PATCH', body: { suspended: true, reason: b.reason } }), 'Client suspended — their users lose access on their next request.'); }}>
              <input name="reason" className="input" placeholder="Reason (recorded in audit log)" aria-label="Suspension reason" required />
              <button className="btn-ghost whitespace-nowrap py-1.5 text-xs text-red-800">Suspend</button>
            </form>
          )}
        </div>
        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-red-800">{error}</p>}
      </div>
    </Modal>
  );
}

function TeamPanel({ superAdmin, onFlash }: { superAdmin: boolean; onFlash: (m: FlashMsg) => void }) {
  const team = useApi<Staff[]>('/admin/team');
  const [adding, setAdding] = useState(false);
  async function act(fn: () => Promise<unknown>, ok: string) {
    try { await fn(); onFlash({ kind: 'ok', text: ok }); team.reload(); } catch (e) { onFlash({ kind: 'err', text: errText(e) }); }
  }
  return (
    <div className="space-y-3">
      {superAdmin && <button className="btn-primary py-1.5 text-xs" onClick={() => setAdding(true)}>Add team member</button>}
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead><tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wider text-ink-3"><th className="p-3">Name</th><th>Role</th><th>Workload</th><th>2FA</th><th>Last sign-in</th><th>Status</th>{superAdmin && <th />}</tr></thead>
          <tbody>
            {team.data?.map((s) => (
              <tr key={s.id} className={`border-t border-ink/5 ${s.isActive ? '' : 'opacity-60'}`}>
                <td className="p-3"><p className="font-medium">{s.name}</p><p className="text-xs text-ink-3">{s.email}</p></td>
                <td>{superAdmin ? (
                  <select className="input py-1 text-xs" defaultValue={s.staffRole} aria-label={`Role for ${s.name}`} onChange={(e) => act(() => api(`/admin/users/${s.id}/role`, { method: 'PATCH', body: { staffRole: e.target.value } }), `${s.name} is now ${human(e.target.value)}.`)}>{ROLES.map((r) => <option key={r} value={r}>{human(r)}</option>)}</select>
                ) : human(s.staffRole)}</td>
                <td className="text-xs">{s.clients} clients · {s.openTasks} tasks · {s.openTickets} tickets</td>
                <td>{s.twoFactorEnabled ? <Status s="ACTIVE" label="On" /> : <span className="text-xs text-ink-3">Off</span>}</td>
                <td className="text-xs">{dt(s.lastLoginAt)}</td>
                <td>{s.isActive ? <Status s="ACTIVE" /> : <Status s="CANCELLED" label="Disabled" />}</td>
                {superAdmin && <td className="space-x-2 whitespace-nowrap p-3 text-right">
                  {s.twoFactorEnabled && <button className="text-xs underline" onClick={() => act(() => api(`/admin/users/${s.id}/reset-2fa`, { method: 'POST' }), `2FA reset for ${s.name}; they re-enrol at next sign-in.`)}>Reset 2FA</button>}
                  {s.isActive
                    ? <button className="btn-ghost py-1 text-xs text-red-800" onClick={() => act(() => api(`/admin/users/${s.id}/deactivate`, { method: 'PATCH' }), `${s.name} disabled — access revoked immediately.`)}>Disable</button>
                    : <button className="btn-ghost py-1 text-xs" onClick={() => act(() => api(`/admin/users/${s.id}/reactivate`, { method: 'PATCH' }), `${s.name} re-enabled.`)}>Enable</button>}
                </td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {adding && (
        <Modal title="Add team member" onClose={() => setAdding(false)}>
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); const b = formBody(e.currentTarget); act(async () => { await api('/admin/users/staff', { method: 'POST', body: b }); setAdding(false); }, 'Team member added. Share the temporary password securely and ask them to change it.'); }}>
            <div><label className="label" htmlFor="st-name">Name</label><input id="st-name" name="name" className="input" required /></div>
            <div><label className="label" htmlFor="st-email">Work email</label><input id="st-email" name="email" type="email" className="input" required /></div>
            <div><label className="label" htmlFor="st-role">Role</label><select id="st-role" name="staffRole" className="input">{ROLES.map((r) => <option key={r} value={r}>{human(r)}</option>)}</select></div>
            <div><label className="label" htmlFor="st-pw">Temporary password (12+)</label><input id="st-pw" name="password" type="text" className="input" minLength={12} required autoComplete="off" /></div>
            <p className="text-xs text-ink-3 sm:col-span-2">Least privilege: pick the narrowest role. Super admins must enable two-factor authentication at first sign-in.</p>
            <div className="sm:col-span-2"><button className="btn-primary">Create account</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function PlansPanel({ superAdmin, onFlash }: { superAdmin: boolean; onFlash: (m: FlashMsg) => void }) {
  const plans = useApi<PlanRow[]>('/admin/plans');
  async function act(fn: () => Promise<unknown>, ok: string) {
    try { await fn(); onFlash({ kind: 'ok', text: ok }); plans.reload(); } catch (e) { onFlash({ kind: 'err', text: errText(e) }); plans.reload(); }
  }
  if (!plans.data) return <Empty>{plans.error ?? 'Loading…'}</Empty>;
  const keys = plans.data[0]?.features ?? [];
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-3">Limits are enforced by the API on every request. Defaults come from the plan matrix; changes here are audited and apply immediately to new requests. {superAdmin ? '' : 'Only a super admin can edit.'}</p>
      <div className="grid gap-4 md:grid-cols-3">
        {plans.data.map((p) => (
          <form key={p.code} className="card space-y-2 p-5" onSubmit={(e) => { e.preventDefault(); const rupees = Number(new FormData(e.currentTarget).get('price')); act(() => api(`/admin/plans/${p.code}`, { method: 'PATCH', body: { pricePaise: Math.round(rupees * 100) } }), `${p.name} price updated for new checkouts and renewals.`); }}>
            <p className="label">{p.name} · {p.activeSubscriptions} active</p>
            <div className="flex items-center gap-2"><span>₹</span><input name="price" type="number" min={1} step="1" className="input" defaultValue={p.pricePaise / 100} disabled={!superAdmin} aria-label={`${p.name} monthly price`} /><span className="whitespace-nowrap text-xs text-ink-3">/mo + GST</span></div>
            {superAdmin && <button className="btn-ghost py-1 text-xs">Save price</button>}
          </form>
        ))}
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead><tr className="border-b border-ink/10 text-left"><th className="p-3">Feature</th>{plans.data.map((p) => <th key={p.code} className="p-3 text-center">{p.name}</th>)}</tr></thead>
          <tbody>
            {keys.map((f, i) => (
              <tr key={f.key} className="border-t border-ink/5">
                <td className="p-3">{(i === 0 || keys[i - 1].section !== f.section) && <span className="block text-[10px] uppercase tracking-wider text-ink-3">{SECTION_LABEL[f.section]}</span>}{f.label}</td>
                {plans.data!.map((p) => {
                  const pf = p.features.find((x) => x.key === f.key)!;
                  return (
                    <td key={p.code} className="p-3 text-center">
                      <label className="inline-flex items-center gap-2">
                        <input type="checkbox" checked={pf.enabled} disabled={!superAdmin} aria-label={`${f.label} in ${p.name}`} onChange={(e) => act(() => api(`/admin/plans/${p.code}/features/${f.key}`, { method: 'PATCH', body: { enabled: e.target.checked, ...(pf.metered ? { limitValue: pf.limitValue } : {}) } }), `${f.label} ${e.target.checked ? 'enabled' : 'disabled'} on ${p.name}.`)} />
                        {pf.metered && pf.enabled && (
                          <input type="number" min={0} className="input w-20 py-1 text-xs" placeholder="∞" defaultValue={pf.limitValue ?? ''} disabled={!superAdmin} aria-label={`${f.label} limit on ${p.name}`}
                            onBlur={(e) => { const v = e.target.value === '' ? null : Number(e.target.value); if (v !== pf.limitValue) act(() => api(`/admin/plans/${p.code}/features/${f.key}`, { method: 'PATCH', body: { enabled: true, limitValue: v } }), `${p.name}: ${f.label} limit set to ${v ?? 'unlimited'}.`); }} />
                        )}
                      </label>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function PaymentsPanel() {
  const [status, setStatus] = useState('');
  const list = useApi<Payment[]>(`/admin/payments${status ? `?status=${status}` : ''}`);
  return (
    <div className="space-y-3">
      <select className="input w-48" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter payments"><option value="">All payments</option>{['VERIFIED', 'FAILED', 'INITIATED', 'REFUNDED'].map((s) => <option key={s} value={s}>{human(s)}</option>)}</select>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead><tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wider text-ink-3"><th className="p-3">Date</th><th>Client</th><th>Amount</th><th>GST</th><th>Status</th><th>Razorpay</th><th>Invoice</th></tr></thead>
          <tbody>
            {list.data?.map((p) => (
              <tr key={p.id} className="border-t border-ink/5">
                <td className="p-3 text-xs">{dt(p.createdAt)}</td><td>{p.organization.brandName ?? p.organization.legalName}</td><td>{inrExact(p.amountPaise)}</td><td className="text-xs">{inrExact(p.taxPaise)}</td>
                <td><Status s={p.status} />{p.failureReason && <span className="block text-xs text-red-800">{p.failureReason}</span>}</td>
                <td className="font-mono text-[11px] text-ink-3">{p.razorpayPaymentId ?? p.razorpayOrderId ?? '—'}</td>
                <td>{p.invoice ? <Link className="underline" href={`/invoices/${p.invoice.id}?staff=1`} target="_blank">{p.invoice.number}</Link> : '—'}</td>
              </tr>
            ))}
            {list.data && !list.data.length && <tr><td className="p-4 text-ink-3" colSpan={7}>No payments.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InquiriesPanel({ onFlash }: { onFlash: (m: FlashMsg) => void }) {
  const list = useApi<Inquiry[]>('/admin/inquiries');
  async function set(id: string, status: string) {
    try { await api(`/admin/inquiries/${id}`, { method: 'PATCH', body: { status } }); list.reload(); } catch (e) { onFlash({ kind: 'err', text: errText(e) }); }
  }
  return (
    <div className="space-y-2">
      {list.data?.map((q) => (
        <div key={q.id} className="card p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><p className="font-semibold">{q.name}{q.business ? ` · ${q.business}` : ''}</p><p className="text-xs text-ink-3"><a className="underline" href={`mailto:${q.email}`}>{q.email}</a>{q.phone ? ` · ${q.phone}` : ''} · {human(q.topic)} · {dt(q.createdAt)}</p></div>
            <select className="input w-40 py-1 text-xs" value={q.status} onChange={(e) => set(q.id, e.target.value)} aria-label="Enquiry status">{['NEW', 'CONTACTED', 'CONVERTED', 'CLOSED'].map((s) => <option key={s} value={s}>{human(s)}</option>)}</select>
          </div>
          <p className="mt-2 whitespace-pre-line text-sm">{q.message}</p>
        </div>
      ))}
      {list.data && !list.data.length && <Empty>No enquiries yet. They arrive from the Contact page.</Empty>}
    </div>
  );
}

function AnnouncePanel({ onFlash }: { onFlash: (m: FlashMsg) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <form className="card max-w-2xl space-y-3 p-6" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true);
      const form = e.currentTarget;
      try { const r = await api<{ recipients: number }>('/admin/announcements', { method: 'POST', body: formBody(form) }); onFlash({ kind: 'ok', text: `Announcement sent to ${r.recipients} client${r.recipients === 1 ? '' : 's'} (dashboard + email connector).` }); form.reset(); }
      catch (err) { onFlash({ kind: 'err', text: errText(err) }); }
      setBusy(false);
    }}>
      <p className="text-sm text-ink-3">Operational notices to clients with an active plan — schedule changes, marketplace policy updates, holidays.</p>
      <div><label className="label" htmlFor="an-aud">Audience</label><select id="an-aud" name="audience" className="input"><option value="ALL_ACTIVE">All active clients</option><option value="RESELLER">Reseller</option><option value="GROWTH">Growth</option><option value="PREMIUM">Premium</option></select></div>
      <div><label className="label" htmlFor="an-title">Title</label><input id="an-title" name="title" className="input" required minLength={3} /></div>
      <div><label className="label" htmlFor="an-body">Message</label><textarea id="an-body" name="body" className="input min-h-28" required minLength={5} /></div>
      <button className="btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send announcement'}</button>
    </form>
  );
}

function AuditPanel() {
  const [action, setAction] = useState('');
  const list = useApi<Audit[]>(`/admin/audit${action ? `?action=${encodeURIComponent(action)}` : ''}`);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <select className="input w-64" value={action} onChange={(e) => setAction(e.target.value)} aria-label="Filter by action">
        <option value="">All actions (latest 100)</option>
        {['auth.', 'staff.', 'user.', 'subscription.', 'payment.', 'plan.', 'organization.', 'document.', 'ticket.', 'listing.', 'labels.', 'thank_you.', 'marketplace.', 'request.', 'task.'].map((a) => <option key={a} value={a}>{a.replace('.', '')}</option>)}
      </select>
      <div className="card divide-y divide-ink/5">
        {list.data?.map((a) => (
          <div key={a.id} className="p-3 text-sm">
            <button className="flex w-full flex-wrap items-center justify-between gap-2 text-left" onClick={() => setOpen(open === a.id ? null : a.id)}>
              <span><code className="text-xs font-semibold">{a.action}</code> <span className="text-ink-3">{a.entity}{a.entityId ? ` ${a.entityId.slice(0, 10)}…` : ''}</span></span>
              <span className="text-xs text-ink-3">{a.actor ? `${a.actor.name}${a.actor.staffRole ? ` (${human(a.actor.staffRole)})` : ''}` : a.actorType} · {dt(a.createdAt)}{a.ip ? ` · ${a.ip}` : ''}</span>
            </button>
            {open === a.id && <pre className="mt-2 overflow-x-auto rounded-lg bg-ivory p-3 text-[11px]">{JSON.stringify({ before: a.before, after: a.after, organizationId: a.organizationId }, null, 2)}</pre>}
          </div>
        ))}
      </div>
    </div>
  );
}

interface AgentUsage { month: string; model: string; enabled: boolean; usdInr: number; totalUsd: number; totalInr: number; note: string; clients: { organizationId: string; name: string; replies: number; messages: number; toolCalls: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; costUsd: number; costInr: number }[] }

/** Manager chat spend per client (estimated from tokens) — no limits yet; this is for watching the cost. */
function ManagerCostPanel() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const u = useApi<AgentUsage>(`/admin/agent-usage?month=${month}`);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div><label className="label" htmlFor="cost-month">Month</label><input id="cost-month" type="month" className="input w-auto" value={month} onChange={(e) => setMonth(e.target.value)} /></div>
        {u.data && <p className="text-sm text-ink-3">Model {u.data.model} · automatic replies {u.data.enabled ? 'on' : 'off (no API key)'} · ₹ at {u.data.usdInr}/$</p>}
      </div>
      {u.data && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Kpi label="Total this month" value={`₹${u.data.totalInr.toLocaleString('en-IN')}`} sub={`$${u.data.totalUsd}`} />
          <Kpi label="Clients chatting" value={u.data.clients.length} />
          <Kpi label="Average per client" value={u.data.clients.length ? `₹${(u.data.totalInr / u.data.clients.length).toFixed(2)}` : '—'} />
        </div>
      )}
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm" aria-label="Manager cost per client">
          <thead><tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wider text-ink-3"><th className="p-3">Client</th><th>Replies</th><th>Chat messages</th><th>Actions</th><th>Tokens in / out</th><th className="pr-3 text-right">Cost</th></tr></thead>
          <tbody>
            {u.data?.clients.map((c) => (
              <tr key={c.organizationId} className="border-t border-ink/5">
                <td className="p-3 font-medium">{c.name}</td><td>{c.replies}</td><td>{c.messages}</td><td>{c.toolCalls}</td>
                <td className="text-xs">{c.inputTokens.toLocaleString('en-IN')} / {c.outputTokens.toLocaleString('en-IN')}</td>
                <td className="pr-3 text-right">₹{c.costInr.toLocaleString('en-IN')} <span className="text-xs text-ink-3">(${c.costUsd})</span></td>
              </tr>
            ))}
            {u.data && !u.data.clients.length && <tr><td className="p-3 text-ink-3" colSpan={6}>No automatic replies this month.</td></tr>}
          </tbody>
        </table>
      </div>
      {u.data && <p className="text-xs text-ink-3">{u.data.note}</p>}
      {u.error && <Empty>{u.error}</Empty>}
      <QualityCheck />
    </div>
  );
}

interface EvalRow { id: string; status: string; model: string | null; score: number | null; passed: number | null; total: number | null; costMicroUsd: number; error: string | null; createdAt: string }
interface EvalResult { id: string; category: string; pass: boolean; fails: string[]; reply: string }

/** Runs the manager's eval set on the server (its own API key) and shows what failed. */
function QualityCheck() {
  const runs = useApi<EvalRow[]>('/admin/agent-evals');
  const [open, setOpen] = useState<{ id: string; results: EvalResult[] } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const running = runs.data?.some((r) => r.status === 'RUNNING');
  async function start() {
    setMsg(null);
    try { await api('/admin/agent-evals', { method: 'POST' }); setMsg('Started. This takes 2–5 minutes; refresh to see the score.'); runs.reload(); }
    catch (e) { setMsg(errText(e)); }
  }
  async function show(id: string) {
    const r = await api<{ report: { results: EvalResult[] } | null }>(`/admin/agent-evals/${id}`);
    setOpen({ id, results: r.report?.results ?? [] });
  }
  return (
    <section className="card space-y-3 p-5" aria-label="Manager quality check">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h2 className="font-semibold">Quality check</h2><p className="text-xs text-ink-3">Runs the manager through the test chats (onboarding, off-topic, secrets, plan limits, escalation, style) with the server&rsquo;s API key. A full run costs a few US cents.</p></div>
        <div className="flex gap-2"><button className="btn-ghost py-1.5 text-xs" onClick={runs.reload}>Refresh</button><button className="btn-primary py-1.5 text-xs" disabled={running} onClick={start}>{running ? 'Running…' : 'Run quality check'}</button></div>
      </div>
      {msg && <p role="status" className="text-xs text-ink-2">{msg}</p>}
      <table className="w-full text-sm"><tbody>
        {runs.data?.map((r) => (
          <tr key={r.id} className="border-t border-ink/5">
            <td className="py-2">{new Date(r.createdAt).toLocaleString('en-IN')}</td>
            <td>{r.status === 'DONE' ? <strong>{r.passed}/{r.total} ({Math.round((r.score ?? 0) * 100)}%)</strong> : r.status === 'FAILED' ? <span className="text-red-700" title={r.error ?? ''}>Failed</span> : 'Running…'}</td>
            <td className="text-xs text-ink-3">{r.model ?? ''} · ${(r.costMicroUsd / 1e6).toFixed(4)}</td>
            <td className="text-right">{r.status === 'DONE' && <button className="text-xs underline" onClick={() => show(r.id)}>Details</button>}</td>
          </tr>
        ))}
        {runs.data && !runs.data.length && <tr><td className="py-2 text-ink-3">No quality checks yet.</td></tr>}
      </tbody></table>
      {open && (
        <div className="space-y-2 rounded-xl bg-ivory p-3" data-testid="eval-details">
          {open.results.filter((x) => !x.pass).map((x) => (
            <div key={x.id} className="text-xs"><p className="font-semibold">✗ {x.id} <span className="font-normal text-ink-3">({x.category})</span>: {x.fails.join('; ')}</p><p className="text-ink-3">Reply: {x.reply || '—'}</p></div>
          ))}
          {!open.results.some((x) => !x.pass) && <p className="text-xs">All checks passed.</p>}
        </div>
      )}
    </section>
  );
}

/** Amazon SP-API: checks the server's keys against the test seller account. */
function AmazonCheck() {
  const [r, setR] = useState<{ ok: boolean; message?: string; amazonIn?: boolean; marketplaces?: { id: string; name: string; participating: boolean }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  async function run() { setBusy(true); try { setR(await api('/admin/amazon/test', { method: 'POST' })); } catch (e) { setR({ ok: false, message: errText(e) }); } setBusy(false); }
  return (
    <section className="card space-y-2 p-5" aria-label="Amazon SP-API">
      <div className="flex items-center justify-between gap-2"><div><h2 className="font-semibold">Amazon SP-API</h2><p className="text-xs text-ink-3">Official Amazon connection (keys are kept in the server environment).</p></div>
        <button className="btn-primary py-1.5 text-xs" disabled={busy} onClick={run}>{busy ? 'Checking…' : 'Test Amazon connection'}</button></div>
      {r && (r.ok
        ? <p className="text-sm text-emerald-800" data-testid="amazon-ok">Connected ✓ {r.amazonIn ? 'Amazon.in is active.' : 'Amazon.in not active on this account.'} Marketplaces: {r.marketplaces?.map((m) => m.name).join(', ')}</p>
        : <p className="text-sm text-red-700" role="alert">{r.message}</p>)}
    </section>
  );
}
