'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formFor, productRef, type Field, type FormKind, type Marketplace } from '../../../packages/catalog-forms/src';
import { api, ApiError } from '@/lib/api';
import { Status, SubTabs } from './ui';

interface Template { id: string; marketplace: Marketplace; kind: FormKind; name: string; data: Record<string, string | number>; updatedAt: string }
interface Submission { id: string; marketplace: Marketplace; kind: FormKind; title: string; createdAt: string; status: string | null; entitlement: string | null }
type Values = Record<string, string>;
interface Lookup { id: string; status: 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED'; fields: Record<string, string | number>; sources: string[]; notes: string | null; error: string | null; cached: boolean }

const KIND_LABEL: Record<FormKind, string> = { MAPPING: 'Mapping', NEW_LISTING: 'New listing' };

/** Listings & Mapping: choose the marketplace, then mapping or new listing, then fill the form (or start from a template). */
export function CatalogForms() {
  const [market, setMarket] = useState<Marketplace>('FLIPKART');
  const [kind, setKind] = useState<FormKind>('MAPPING');
  const [values, setValues] = useState<Values>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [templates, setTemplates] = useState<Template[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [busy, setBusy] = useState<'submit' | 'template' | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const [lookupAvailable, setLookupAvailable] = useState(false);
  const [lookup, setLookup] = useState<{ state: 'idle' | 'running' | 'done' | 'failed'; text?: string; sources?: string[]; link?: string }>({ state: 'idle' });
  const [fromWeb, setFromWeb] = useState<Set<string>>(new Set());
  const lookupRun = useRef(0);
  const valuesRef = useRef<Values>({});
  valuesRef.current = values;
  const def = formFor(market, kind);

  const load = useCallback(async () => {
    const r = await api<{ submissions: Submission[]; templates: Template[]; lookupAvailable?: boolean }>('/catalog-forms');
    setSubmissions(r.submissions); setTemplates(r.templates); setLookupAvailable(Boolean(r.lookupAvailable));
  }, []);
  useEffect(() => { load().catch(() => undefined); }, [load]);
  const mine = useMemo(() => templates.filter((t) => t.marketplace === market && t.kind === kind), [templates, market, kind]);

  function reset(nextMarket = market, nextKind = kind) {
    setMarket(nextMarket); setKind(nextKind); setValues({}); setErrors({}); setTemplateId(''); setTemplateName(''); setMsg({}); setFromWeb(new Set()); setLookup({ state: 'idle' }); lookupRun.current++;
  }
  function useTemplate(id: string) {
    setTemplateId(id); setErrors({}); setMsg({});
    const t = templates.find((x) => x.id === id);
    if (t) { setValues(Object.fromEntries(Object.entries(t.data).map(([k, v]) => [k, String(v)]))); setTemplateName(t.name); }
  }
  const set = (k: string, v: string) => {
    if (fromWeb.has(k)) setFromWeb((x) => { const n = new Set(x); n.delete(k); return n; });
    setValues((x) => ({ ...x, [k]: v }));
    if (errors[k]) setErrors((e) => { const n = { ...e }; delete n[k]; if (!Object.keys(n).length) setMsg((m) => ({ ...m, err: undefined })); return n; });
  };

  /** Submit; with saveTemplate, the same details are also saved under the template name for the next similar product. */
  async function submit(saveTemplate: boolean) {
    const name = templateName.trim();
    if (saveTemplate && !name) { setMsg({ err: 'Give the template a name first.' }); document.getElementById('tpl-name')?.focus(); return; }
    setBusy(saveTemplate ? 'template' : 'submit'); setMsg({}); setErrors({});
    try {
      const r = await api<{ request: { status: string } }>('/catalog-forms', { method: 'POST', body: { marketplace: market, kind, data: values, ...(saveTemplate ? { saveTemplateAs: name } : {}) } });
      setMsg({ ok: `Request sent to your manager${saveTemplate ? ` and saved as template "${name}"` : ''}. ${r.request.status === 'QUEUED' ? 'Work starts shortly.' : 'See the status below.'}` });
      setValues({}); setTemplateId(''); setTemplateName(''); setFromWeb(new Set()); setLookup({ state: 'idle' });
      await load();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) { fail(e); }
    setBusy(null);
  }
  /** Finds the product online (background job on the server) and fills only the fields that are still empty. */
  async function fetchDetails(link: string) {
    if (!lookupAvailable || !link.trim()) return;
    const run = ++lookupRun.current;
    setLookup({ state: 'running', text: 'Finding this product online… this takes up to a minute.', link });
    try {
      let r = await api<Lookup>('/catalog-forms/lookup', { method: 'POST', body: { marketplace: market, kind, link } });
      for (let i = 0; i < 90 && (r.status === 'QUEUED' || r.status === 'RUNNING'); i++) {
        await new Promise((ok) => setTimeout(ok, 2500));
        if (run !== lookupRun.current) return;
        r = await api<Lookup>(`/catalog-forms/lookup/${r.id}`);
      }
      if (run !== lookupRun.current) return;
      if (r.status !== 'DONE') { setLookup({ state: 'failed', text: r.error ?? 'Could not find details online — please fill them in.' }); return; }
      // Only fields that are still empty right now; what the client typed is never overwritten.
      const cur = valuesRef.current;
      const add = Object.fromEntries(Object.entries(r.fields).filter(([k]) => !String(cur[k] ?? '').trim()).map(([k, v]) => [k, String(v)]));
      const filled = Object.keys(add);
      setValues((x) => ({ ...x, ...Object.fromEntries(Object.entries(add).filter(([k]) => !String(x[k] ?? '').trim())) }));
      setFromWeb((x) => new Set([...x, ...filled]));
      const hosts = [...new Set(r.sources.map((u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } }).filter(Boolean))];
      setLookup({ state: 'done', link, sources: hosts, text: filled.length ? `Filled ${filled.length} details from the web — please check the highlighted fields, then add the rest.${r.notes ? ` Note: ${r.notes}` : ''}` : 'Nothing new found online — your fields are unchanged.' });
    } catch (e) {
      if (run === lookupRun.current) setLookup({ state: 'failed', text: (e as Error).message });
    }
  }
  // Mapping: start as soon as a valid ASIN / FSN or link is pasted.
  useEffect(() => {
    const link = values.productLink ?? '';
    if (!lookupAvailable || !link || lookup.link === link || !productRef(market, link)) return;
    const t = setTimeout(() => { fetchDetails(link); }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values.productLink, lookupAvailable, market]);

  async function deleteTemplate() {
    const t = templates.find((x) => x.id === templateId);
    if (!t || !window.confirm(`Delete template "${t.name}"?`)) return;
    await api(`/catalog-forms/templates/${t.id}`, { method: 'DELETE' }).catch(() => undefined);
    setTemplateId(''); await load();
  }
  function fail(e: unknown) {
    const fe = (e as ApiError).body?.fieldErrors as Record<string, string> | undefined;
    if (fe) setErrors(fe);
    setMsg({ err: (e as Error).message });
  }

  return (
    <div className="space-y-6">
      <div><h1 className="font-display text-3xl">Listings &amp; Mapping</h1><p className="mt-1 text-sm text-ink-3">Send your manager everything needed to map a product or create a new listing.</p></div>
      <SubTabs tabs={[['FLIPKART', 'Flipkart'], ['AMAZON', 'Amazon']] as const} value={market} onChange={(m) => reset(m, kind)} />
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Request type">
        {(['MAPPING', 'NEW_LISTING'] as FormKind[]).map((k) => (
          <button key={k} role="tab" aria-selected={kind === k} className={`rounded-full border px-4 py-1.5 text-sm ${kind === k ? 'border-ink bg-ink text-ivory' : 'border-ink/15 bg-white text-ink-2 hover:border-ink/40'}`} onClick={() => reset(market, k)}>{KIND_LABEL[k]}</button>
        ))}
      </div>

      {msg.ok && <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{msg.ok}</p>}

      <section className="card space-y-6 p-6" aria-label={def.title}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="font-display text-xl">{def.title}</h2><p className="text-sm text-ink-3">{def.intro}</p></div>
          {def.draft && <span className="chip bg-amber-50 text-amber-800">Draft form</span>}
        </div>

        <div className="flex flex-wrap items-end gap-2 rounded-xl bg-ivory p-4">
          <div className="min-w-56 flex-1"><label className="label" htmlFor="tpl-pick">Start from a saved template</label>
            <select id="tpl-pick" className="input" value={templateId} onChange={(e) => (e.target.value ? useTemplate(e.target.value) : reset())}>
              <option value="">{mine.length ? 'Select One' : 'No templates yet'}</option>
              {mine.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select></div>
          {templateId && <button className="btn-ghost py-2 text-xs" onClick={deleteTemplate}>Delete template</button>}
        </div>

        {lookupAvailable && lookup.state === 'idle' && <p className="text-xs text-ink-3">Tip: paste the product link first — we fill the product details we can find online, you add the rest.</p>}
        {lookup.state !== 'idle' && (
          <div role="status" aria-label="Online lookup" className={`rounded-xl px-4 py-3 text-sm ${lookup.state === 'failed' ? 'bg-amber-50 text-amber-900' : lookup.state === 'running' ? 'bg-ivory text-ink-2' : 'bg-emerald-50 text-emerald-900'}`}>
            {lookup.text}
            {lookup.sources && lookup.sources.length > 0 && <span className="mt-1 block text-xs opacity-80">Sources: {lookup.sources.join(', ')}</span>}
          </div>
        )}
        {def.sections.map((s) => (
          <fieldset key={s.title} className="space-y-3">
            <legend className="text-sm font-semibold">{s.title}</legend>
            {s.note && <p className="rounded-lg bg-sun/10 px-3 py-2 text-xs text-ink-2">{s.note}</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              {s.fields.map((f) => <FieldInput key={f.key} f={f} value={values[f.key] ?? ''} error={errors[f.key]} onChange={(v) => set(f.key, v)} fromWeb={fromWeb.has(f.key)}
                note={f.key === 'productLink' ? refNote(market, values.productLink ?? '') : undefined}
                action={lookupAvailable && (f.key === 'productLink' || f.key === 'referenceLink') && (values[f.key] ?? '').trim() ? { label: lookup.state === 'running' ? 'Finding…' : 'Fetch details', disabled: lookup.state === 'running', run: () => fetchDetails(values[f.key] ?? '') } : undefined} />)}
            </div>
          </fieldset>
        ))}

        <div className="space-y-3 border-t border-ink/10 pt-5">
          <div className="max-w-sm"><label className="label" htmlFor="tpl-name">Template name (to reuse these details)</label><input id="tpl-name" className="input" value={templateName} maxLength={60} onChange={(e) => setTemplateName(e.target.value)} placeholder="e.g. Tile cleaner 1L – combo of 2" /></div>
          {msg.err && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{msg.err}</p>}
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={busy !== null} onClick={() => submit(false)}>{busy === 'submit' ? 'Sending…' : `Submit ${KIND_LABEL[kind].toLowerCase()} request`}</button>
            <button className="btn-ghost" disabled={busy !== null} onClick={() => submit(true)}>{busy === 'template' ? 'Saving…' : `Save template & submit ${KIND_LABEL[kind].toLowerCase()} request`}</button>
          </div>
        </div>
      </section>

      <section className="card p-6" aria-label="Your listing requests">
        <h2 className="font-semibold">Your listing &amp; mapping requests</h2>
        <ul className="mt-3 divide-y divide-ink/5">
          {submissions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
              <span><span className="font-medium">{s.title}</span><span className="block text-xs text-ink-3">{new Date(s.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span></span>
              {s.entitlement === 'LIMIT_REACHED' ? <span className="chip bg-amber-50 text-amber-800">Monthly limit reached</span> : s.status && <Status s={s.status} />}
            </li>
          ))}
          {!submissions.length && <li className="py-3 text-sm text-ink-3">Nothing sent yet.</li>}
        </ul>
      </section>
    </div>
  );
}

/** Shows the ASIN / FSN found in the pasted link, so the client knows the right product is identified. */
function refNote(mp: Marketplace, link: string) {
  if (!link.trim()) return undefined;
  const ref = productRef(mp, link);
  if (ref) return { ok: true, text: `${ref.type}: ${ref.id} ✓` };
  return { ok: false, text: /^https?:\/\//i.test(link.trim()) ? `${mp === 'AMAZON' ? 'ASIN' : 'FSN'} not visible in this link — your manager will open it to confirm the product.` : `Paste the product page link or the ${mp === 'AMAZON' ? '10-character ASIN' : '16-character FSN'}.` };
}

function FieldInput({ f, value, error, onChange, note, fromWeb, action }: { f: Field; value: string; error?: string; onChange: (v: string) => void; note?: { ok: boolean; text: string }; fromWeb?: boolean; action?: { label: string; disabled: boolean; run: () => void } }) {
  const id = `f-${f.key}`;
  const label = <label className="label" htmlFor={id}>{f.label}{f.required && <span className="text-red-700">*</span>}{fromWeb && <span className="ml-2 chip bg-sky-50 normal-case tracking-normal text-sky-800" data-testid={`web-${f.key}`}>from web — check</span>}</label>;
  const cls = `input ${error ? 'border-red-400' : fromWeb ? 'border-sky-300 bg-sky-50/40' : ''}`;
  let control;
  if (f.type === 'select') {
    control = <select id={id} className={cls} value={value} onChange={(e) => onChange(e.target.value)}><option value="">Select One</option>{f.options!.map((o) => <option key={o} value={o}>{o}</option>)}</select>;
  } else if (f.type === 'textarea') {
    control = <textarea id={id} className={`${cls} min-h-20`} value={value} maxLength={f.maxLength} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />;
  } else {
    const type = f.type === 'number' || f.type === 'money' ? 'number' : f.type === 'date' ? 'date' : 'text';
    control = (
      <div className="flex items-center gap-2">
        <input id={id} className={cls} type={type} inputMode={type === 'number' ? 'decimal' : undefined} step={f.type === 'money' ? '0.01' : undefined} min={f.min} max={f.max} maxLength={f.maxLength} placeholder={f.placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
        {f.unit && <span className="shrink-0 text-xs text-ink-3">{f.unit}</span>}
      </div>
    );
  }
  return (
    <div className={f.type === 'textarea' ? 'sm:col-span-2' : ''}>
      {label}
      {action ? <div className="flex gap-2"><div className="flex-1">{control}</div><button type="button" className="btn-ghost shrink-0 py-2 text-xs" disabled={action.disabled} onClick={action.run}>{action.label}</button></div> : control}
      {error ? <p className="mt-1 text-xs text-red-700">{error}</p> : note ? <p className={`mt-1 text-xs ${note.ok ? 'text-emerald-700' : 'text-amber-800'}`} data-testid="product-ref">{note.text}</p> : f.help && <p className="mt-1 text-xs text-ink-3">{f.help}</p>}
    </div>
  );
}
