'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';

export interface ChatMessage {
  id: string; body: string; createdAt: string; readAt: string | null; isInternalNote: boolean; senderType: 'CUSTOMER' | 'STAFF';
  sender: { id: string; name: string };
  attachments: { id: string; title: string; fileName: string; mimeType: string; sizeBytes: number }[];
}
interface History { organizationId: string; managers: { id: string; name: string }[]; messages: ChatMessage[] }

export async function uploadFile(file: File, fields: Record<string, string>) {
  const fd = new FormData();
  fd.append('file', file);
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const res = await fetch('/api/documents', { method: 'POST', body: fd, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, Array.isArray(data.message) ? data.message.join(', ') : data.message ?? 'Upload failed');
  return data as { id: string; fileName: string };
}

const time = (d: string) => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const size = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/**
 * Manager Chat Support panel. mode=client → /api/chat; mode=staff → /api/ops/chats/:orgId (internal notes available).
 * Live updates via Server-Sent Events.
 */
export function ChatPanel({ mode, orgId, onActivity }: { mode: 'client' | 'staff'; orgId?: string; onActivity?: () => void }) {
  const base = mode === 'client' ? '/chat' : `/ops/chats/${orgId}`;
  const streamUrl = mode === 'client' ? '/api/chat/stream' : '/api/ops/chats/stream';
  const [hist, setHist] = useState<History | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (q?: string) => {
    try {
      setHist(await api<History>(`${base}${q ? `?q=${encodeURIComponent(q)}` : ''}`));
      if (!q) await api(`${base}/read`, { method: 'POST' });
    } catch (e) { setError((e as Error).message); }
  }, [base]);

  useEffect(() => { setHist(null); setQuery(''); load(); }, [load]);

  useEffect(() => {
    const es = new EventSource(streamUrl);
    es.addEventListener('message', (ev) => {
      const e = JSON.parse((ev as MessageEvent).data);
      onActivity?.();
      if (mode === 'staff' && e.organizationId !== orgId) return;
      setHist((h) => (h && !h.messages.some((m) => m.id === e.message.id) ? { ...h, messages: [...h.messages, e.message] } : h));
      const fromOtherSide = mode === 'client' ? e.message.senderType === 'STAFF' : e.message.senderType === 'CUSTOMER';
      if (fromOtherSide && document.visibilityState === 'visible') api(`${base}/read`, { method: 'POST' }).catch(() => {});
    });
    es.addEventListener('read', (ev) => {
      const e = JSON.parse((ev as MessageEvent).data);
      if (mode === 'staff' && e.organizationId !== orgId) return;
      const mine = mode === 'client' ? 'CUSTOMER' : 'STAFF';
      if (e.by === mine) return;
      setHist((h) => h && { ...h, messages: h.messages.map((m) => (m.senderType === mine && !m.readAt && !m.isInternalNote ? { ...m, readAt: e.at } : m)) });
    });
    return () => es.close();
  }, [streamUrl, base, mode, orgId, onActivity]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [hist?.messages.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() && !files.length) return;
    setBusy(true); setError(null);
    try {
      const fields: Record<string, string> = { kind: 'CHAT_ATTACHMENT', ...(mode === 'staff' ? { organizationId: orgId! } : {}), ...(internal ? { visibility: 'INTERNAL' } : {}) };
      const documentIds = [];
      for (const f of files) documentIds.push((await uploadFile(f, fields)).id);
      const m = await api<ChatMessage>(`${base}/messages`, { method: 'POST', body: { body: text.trim(), documentIds, ...(mode === 'staff' ? { internal } : {}) } });
      setHist((h) => (h && !h.messages.some((x) => x.id === m.id) ? { ...h, messages: [...h.messages, m] } : h));
      setText(''); setFiles([]); if (fileRef.current) fileRef.current.value = '';
    } catch (err) { setError((err as Error).message); }
    setBusy(false);
  }

  const mineType = mode === 'client' ? 'CUSTOMER' : 'STAFF';
  return (
    <div className="card flex h-[70vh] min-h-[28rem] flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink/10 px-5 py-3">
        <div className="text-sm">
          <p className="font-semibold">Manager Chat Support</p>
          <p className="text-xs text-ink-3">{hist?.managers.length ? `Your manager: ${hist.managers.map((m) => m.name).join(', ')}` : 'A SOLLUNA manager will reply here'}</p>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); load(query || undefined); }} className="flex gap-1">
          <input aria-label="Search messages" className="input w-40 py-1.5 text-xs" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
          {query && <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={() => { setQuery(''); load(); }}>Clear</button>}
        </form>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto bg-ivory/50 px-4 py-4" aria-live="polite" data-testid="chat-log">
        {!hist && !error && <p className="text-center text-sm text-ink-3">Loading conversation…</p>}
        {hist?.messages.length === 0 && <p className="text-center text-sm text-ink-3">{query ? 'No messages match.' : 'No messages yet. Ask anything about your account, listings or reports.'}</p>}
        {hist?.messages.map((m) => {
          const mine = m.senderType === mineType;
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm shadow-sm ${m.isInternalNote ? 'border border-dashed border-sun bg-sun/10' : mine ? 'bg-ink text-ivory' : 'bg-white'}`} data-testid="chat-message">
                {m.isInternalNote && <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-sun-3">Internal note · not visible to client</p>}
                {!mine && <p className="mb-0.5 text-xs font-semibold opacity-70">{m.sender.name}</p>}
                {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                {m.attachments.map((a) => (
                  <a key={a.id} href={`/api/documents/${a.id}/download`} className={`mt-1.5 flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs underline ${mine && !m.isInternalNote ? 'bg-white/10' : 'bg-ink/5'}`}>
                    📎 {a.fileName} <span className="opacity-60">({size(a.sizeBytes)})</span>
                  </a>
                ))}
                <p className="mt-1 text-[10px] opacity-60">{time(m.createdAt)}{mine && !m.isInternalNote ? (m.readAt ? ' · Seen' : ' · Sent') : ''}</p>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      <form onSubmit={send} className="space-y-2 border-t border-ink/10 p-3">
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-800">{error}</p>}
        {files.length > 0 && <p className="text-xs text-ink-3">Attaching: {files.map((f) => f.name).join(', ')}</p>}
        <div className="flex items-end gap-2">
          <label className="btn-ghost cursor-pointer px-3" title="Attach files (PDF, images, Excel, Word, CSV)">
            📎<input ref={fileRef} type="file" multiple className="hidden" accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.docx,.csv,.txt" onChange={(e) => setFiles([...(e.target.files ?? [])].slice(0, 5))} data-testid="chat-file" />
          </label>
          <textarea aria-label="Message" className="input min-h-[2.75rem] flex-1 resize-none" rows={1} value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e); } }} placeholder={internal ? 'Internal note for SOLLUNA staff…' : 'Write a message…'} />
          <button className="btn-primary" disabled={busy}>{busy ? '…' : 'Send'}</button>
        </div>
        {mode === 'staff' && (
          <label className="flex items-center gap-2 text-xs text-ink-3"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal note (never shown to the client)</label>
        )}
      </form>
    </div>
  );
}

const KINDS: [string, string][] = [
  ['GST_CERT', 'GST certificate'], ['PAN', 'PAN'], ['INVOICE', 'Purchase invoice'], ['BRAND_AUTH', 'Brand authorization'],
  ['STATEMENT', 'Marketplace statement'], ['LISTING_ASSETS', 'Product images / content'], ['OTHER', 'Other'],
];
const KIND_LABEL: Record<string, string> = Object.fromEntries([...KINDS, ['REPORT', 'Report'], ['CA_DOCUMENT', 'CA document'], ['LABELS', 'Shipping labels'], ['CHAT_ATTACHMENT', 'Chat attachment']]);

interface Doc { id: string; kind: string; title: string; fileName: string; mimeType: string; sizeBytes: number; createdAt: string; uploadedById: string; visibility: string }

export function DocumentsPanel({ orgId, staff = false, myId }: { orgId?: string; staff?: boolean; myId?: string }) {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const q = staff ? `?organizationId=${orgId}` : '';
  const load = useCallback(() => api<Doc[]>(`/documents${q}`).then(setDocs).catch((e) => setError(e.message)), [q]);
  useEffect(() => { load(); }, [load]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const file = f.get('file') as File;
    if (!file || !file.size) { setError('Choose a file'); return; }
    setBusy(true); setError(null); setMsg(null);
    try {
      await uploadFile(file, { kind: String(f.get('kind')), title: String(f.get('title') ?? ''), ...(staff ? { organizationId: orgId!, visibility: String(f.get('visibility')) } : {}) });
      (e.target as HTMLFormElement).reset();
      setMsg('Uploaded.');
      load();
    } catch (err) { setError((err as Error).message); }
    setBusy(false);
  }

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="card grid gap-3 p-5 sm:grid-cols-[1fr_1fr_auto] sm:items-end" aria-label="Upload document">
        <div><label className="label" htmlFor="doc-file">File (PDF, image, Excel, Word, CSV · max 10 MB)</label><input id="doc-file" name="file" type="file" className="input" accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.docx,.csv,.txt" /></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="label" htmlFor="doc-kind">Type</label><select id="doc-kind" name="kind" className="input">{(staff ? [...KINDS, ['REPORT', 'Report'], ['CA_DOCUMENT', 'CA document'], ['LABELS', 'Shipping labels']] : KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          {staff
            ? <div><label className="label" htmlFor="doc-vis">Visible to</label><select id="doc-vis" name="visibility" className="input"><option value="CLIENT">Client + SOLLUNA</option><option value="INTERNAL">SOLLUNA only</option></select></div>
            : <div><label className="label" htmlFor="doc-title">Title (optional)</label><input id="doc-title" name="title" className="input" /></div>}
        </div>
        <button className="btn-primary" disabled={busy}>{busy ? 'Uploading…' : 'Upload'}</button>
        {(error || msg) && <p role={error ? 'alert' : 'status'} className={`text-sm sm:col-span-3 ${error ? 'text-red-800' : 'text-emerald-800'}`}>{error ?? msg}</p>}
      </form>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead><tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wider text-ink-3"><th className="p-3">Document</th><th>Type</th><th>Size</th><th>Added</th><th /></tr></thead>
          <tbody>
            {docs?.map((d) => (
              <tr key={d.id} className="border-t border-ink/5">
                <td className="p-3 font-medium">{d.title || d.fileName}{d.visibility === 'INTERNAL' && <span className="chip ml-2 bg-sun/15 text-sun-3">Internal</span>}</td>
                <td className="text-ink-3">{KIND_LABEL[d.kind] ?? d.kind}</td>
                <td className="text-ink-3">{size(d.sizeBytes)}</td>
                <td className="text-ink-3">{new Date(d.createdAt).toLocaleDateString('en-IN')}</td>
                <td className="space-x-3 pr-3 text-right">
                  <a className="font-semibold underline" href={`/api/documents/${d.id}/download`}>Download</a>
                  {!staff && d.uploadedById === myId && d.kind !== 'CHAT_ATTACHMENT' && (
                    <button className="text-xs text-ink-3 underline" onClick={async () => { await api(`/documents/${d.id}`, { method: 'DELETE' }); load(); }}>Delete</button>
                  )}
                </td>
              </tr>
            ))}
            {docs?.length === 0 && <tr><td className="p-3 text-ink-3" colSpan={5}>No documents yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-3">Files are checked by their content (not just the name) and only shared with your SOLLUNA team.</p>
    </div>
  );
}
