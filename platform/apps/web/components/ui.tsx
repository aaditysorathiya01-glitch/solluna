'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';

const STATUS_STYLE: Record<string, string> = {
  COMPLETED: 'bg-emerald-50 text-emerald-800', PARTIALLY_COMPLETED: 'bg-amber-50 text-amber-800', CANCELLED: 'bg-ink/5 text-ink-3',
  BLOCKED: 'bg-red-50 text-red-800', AWAITING_CLIENT_APPROVAL: 'bg-sun/15 text-sun-3', AWAITING_INFORMATION: 'bg-sun/15 text-sun-3',
  PLAN_VERIFICATION: 'bg-moon/10 text-moon', IN_PROGRESS: 'bg-moon/10 text-moon', QUEUED: 'bg-ink/5 text-ink-2', NEW: 'bg-ink/5 text-ink-2',
  UNDER_MARKETPLACE_REVIEW: 'bg-moon/10 text-moon', ACTIVE: 'bg-emerald-50 text-emerald-800', GRACE_PERIOD: 'bg-amber-50 text-amber-800',
  VERIFIED: 'bg-emerald-50 text-emerald-800', FAILED: 'bg-red-50 text-red-800', INITIATED: 'bg-ink/5 text-ink-2', REQUESTED: 'bg-sun/15 text-sun-3',
  APPROVED: 'bg-emerald-50 text-emerald-800', DECLINED: 'bg-red-50 text-red-800',
  // tickets
  ASSIGNED: 'bg-moon/10 text-moon', WAITING_FOR_CLIENT: 'bg-sun/15 text-sun-3', WAITING_FOR_MARKETPLACE: 'bg-moon/10 text-moon', RESOLVED: 'bg-emerald-50 text-emerald-800', CLOSED: 'bg-ink/5 text-ink-3',
  // listings / mapping / marketplaces / labels / stock / thank-you
  REJECTED: 'bg-red-50 text-red-800', PROCESSING_ERROR: 'bg-red-50 text-red-800', SUPPRESSED: 'bg-red-50 text-red-800', CATALOG_ID_CREATED: 'bg-emerald-50 text-emerald-800',
  EXACT_VERIFIED: 'bg-emerald-50 text-emerald-800', HIGH_CONFIDENCE: 'bg-sun/15 text-sun-3', REVIEW_REQUIRED: 'bg-amber-50 text-amber-800', NO_MATCH_FOUND: 'bg-ink/5 text-ink-3', CONFLICT: 'bg-red-50 text-red-800', NOT_ELIGIBLE_OR_BLOCKED: 'bg-red-50 text-red-800', NOT_ASSESSED: 'bg-ink/5 text-ink-2',
  CONNECTED: 'bg-emerald-50 text-emerald-800', PENDING: 'bg-sun/15 text-sun-3', ERROR: 'bg-red-50 text-red-800', DISCONNECTED: 'bg-ink/5 text-ink-3', NOT_PROVIDED: 'bg-ink/5 text-ink-3',
  READY: 'bg-sun/15 text-sun-3', DELIVERED: 'bg-emerald-50 text-emerald-800', PROCESSING: 'bg-moon/10 text-moon',
  CRITICAL: 'bg-red-600 text-white', HIGH: 'bg-red-50 text-red-800', MEDIUM: 'bg-amber-50 text-amber-800', WATCH: 'bg-moon/10 text-moon', HEALTHY: 'bg-emerald-50 text-emerald-800',
  DRAFT: 'bg-ink/5 text-ink-2', CLIENT_REVIEW: 'bg-sun/15 text-sun-3', REVISION_REQUESTED: 'bg-amber-50 text-amber-800', EXPIRED: 'bg-ink/5 text-ink-3', PAST_DUE: 'bg-red-50 text-red-800',
  CONTACTED: 'bg-moon/10 text-moon', CONVERTED: 'bg-emerald-50 text-emerald-800',
};
export const human = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
export const Status = ({ s, label }: { s: string; label?: string }) => <span className={`chip ${STATUS_STYLE[s] ?? 'bg-ink/5 text-ink-2'}`}>{label ?? human(s)}</span>;
export const mpName = (m: string | null | undefined) => (m === 'AMAZON' ? 'Amazon' : m === 'FLIPKART' ? 'Flipkart' : '—');
export const dt = (s: string | null | undefined) => (s ? new Date(s).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export const d = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '—');
export const inrExact = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export type FlashMsg = { kind: 'ok' | 'err'; text: string } | null;

export function Flash({ msg, onClose }: { msg: FlashMsg; onClose: () => void }) {
  if (!msg) return null;
  return (
    <div role={msg.kind === 'err' ? 'alert' : 'status'} className={`rounded-xl px-4 py-3 text-sm ${msg.kind === 'ok' ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-900'}`}>
      <span className="whitespace-pre-line">{msg.text}</span> <button className="ml-2 underline" onClick={onClose}>Dismiss</button>
    </div>
  );
}

/** Error text from an API failure, including field-level validation messages. */
export const errText = (e: unknown) => {
  const a = e as ApiError;
  return a.issues?.length ? a.issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join(' · ') : a.message;
};

/** Load data from the API, with reload and stale-response protection. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const reload = useCallback(async () => {
    if (!path) return;
    const mine = ++seq.current;
    try { const r = await api<T>(path); if (mine === seq.current) { setData(r); setError(null); } }
    catch (e) { if (mine === seq.current) setError(errText(e)); }
  }, [path]);
  useEffect(() => { setData(null); reload(); }, [reload]);
  return { data, error, reload, setData };
}

export const formBody = (form: HTMLFormElement) =>
  Object.fromEntries([...new FormData(form).entries()].map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]).filter(([, v]) => v !== ''));

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="card p-6 text-sm text-ink-3">{children}</p>;
}

export function SubTabs<T extends string>({ tabs, value, onChange }: { tabs: readonly (readonly [T, string])[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1" role="tablist">
      {tabs.map(([k, label]) => (
        <button key={k} role="tab" aria-selected={value === k} onClick={() => onChange(k)} className={value === k ? 'btn-primary py-1.5 text-xs' : 'btn-ghost py-1.5 text-xs'}>{label}</button>
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-ink/40 p-4 sm:items-center" role="dialog" aria-modal aria-label={title} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="card my-8 w-full max-w-2xl p-6">
        <div className="mb-4 flex items-start justify-between gap-4"><h2 className="font-display text-xl">{title}</h2><button className="text-ink-3 hover:text-ink" aria-label="Close" onClick={onClose}>✕</button></div>
        {children}
      </div>
    </div>
  );
}

interface Notification { id: string; title: string; body: string; createdAt: string; readAt: string | null; type: string }

/** Header bell: unread count, latest 50, mark one / all read. Polls every 60 s. */
export function NotificationBell({ dark = false }: { dark?: boolean }) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<Notification[]>([]);
  const refresh = useCallback(async () => {
    try { setCount((await api<{ count: number }>('/notifications/unread-count')).count); } catch { /* signed out */ }
  }, []);
  useEffect(() => { refresh(); const t = setInterval(refresh, 60_000); return () => clearInterval(t); }, [refresh]);
  async function toggle() {
    if (!open) setItems(await api<Notification[]>('/notifications'));
    setOpen(!open);
  }
  async function readAll() { await api('/notifications/read-all', { method: 'POST' }); setCount(0); setItems((x) => x.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() }))); }
  async function readOne(n: Notification) {
    if (n.readAt) return;
    await api(`/notifications/${n.id}/read`, { method: 'POST' });
    setCount((c) => Math.max(0, c - 1));
    setItems((x) => x.map((i) => (i.id === n.id ? { ...i, readAt: new Date().toISOString() } : i)));
  }
  return (
    <div className="relative">
      <button onClick={toggle} aria-label={`Notifications${count ? `, ${count} unread` : ''}`} aria-expanded={open} className={`relative rounded-full p-2 ${dark ? 'text-ivory/80 hover:text-ivory' : 'text-ink-2 hover:text-ink'}`}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
        {count > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-5 rounded-full bg-sun px-1 text-center text-[10px] font-bold leading-5 text-ink">{count > 99 ? '99+' : count}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-[min(92vw,380px)] overflow-hidden rounded-2xl border border-ink/10 bg-white text-ink shadow-xl">
          <div className="flex items-center justify-between border-b border-ink/10 px-4 py-3"><p className="text-sm font-semibold">Notifications</p>{count > 0 && <button className="text-xs underline" onClick={readAll}>Mark all read</button>}</div>
          <ul className="max-h-[60vh] divide-y divide-ink/5 overflow-y-auto">
            {items.map((n) => (
              <li key={n.id}>
                <button className={`w-full px-4 py-3 text-left ${n.readAt ? '' : 'bg-sun/5'}`} onClick={() => readOne(n)}>
                  <p className="flex items-start gap-2 text-sm font-medium">{!n.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-sun" aria-label="unread" />}{n.title}</p>
                  <p className="mt-0.5 line-clamp-3 whitespace-pre-line text-xs text-ink-3">{n.body.replace(/\*\*/g, '')}</p>
                  <p className="mt-1 text-[11px] text-ink-3/70">{dt(n.createdAt)}</p>
                </button>
              </li>
            ))}
            {!items.length && <li className="px-4 py-6 text-sm text-ink-3">You&apos;re all caught up.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
