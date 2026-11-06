'use client';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';

export function ContactForm() {
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Record<string, string>>({});

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState('busy'); setError(null); setIssues({});
    const body = Object.fromEntries([...new FormData(e.currentTarget).entries()].filter(([k, v]) => k === 'website' || String(v).trim() !== ''));
    try {
      await api('/public/contact', { method: 'POST', body });
      setState('sent');
    } catch (err) {
      const a = err as ApiError;
      setError(a.status === 429 ? 'Too many messages — please try again in a minute.' : a.message);
      if (a.issues) setIssues(Object.fromEntries(a.issues.map((i) => [i.path, i.message])));
      setState('idle');
    }
  }

  if (state === 'sent') {
    return (
      <div role="status" className="card p-7">
        <p className="font-display text-2xl">Thank you — message received.</p>
        <p className="mt-2 text-sm text-ink-3">A SOLLUNA team member will reply by email within one business day.</p>
      </div>
    );
  }
  const field = (name: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <label className="label" htmlFor={`c-${name}`}>{label}</label>
      <input className="input" id={`c-${name}`} name={name} {...props} />
      {issues[name] && <p className="mt-1 text-xs text-red-700">{issues[name]}</p>}
    </div>
  );
  return (
    <form onSubmit={submit} className="card space-y-4 p-7" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        {field('name', 'Your name', { required: true, autoComplete: 'name' })}
        {field('email', 'Email', { type: 'email', required: true, autoComplete: 'email' })}
        {field('phone', 'Mobile (optional)', { type: 'tel', autoComplete: 'tel', placeholder: '98XXXXXXXX' })}
        {field('business', 'Business / brand (optional)', { autoComplete: 'organization' })}
      </div>
      <div>
        <label className="label" htmlFor="c-topic">Topic</label>
        <select className="input" id="c-topic" name="topic" defaultValue="PLANS">
          <option value="PLANS">Choosing a plan</option>
          <option value="GENERAL">General question</option>
          <option value="SUPPORT">Existing client support</option>
          <option value="PARTNERSHIP">Partnership</option>
        </select>
      </div>
      <div>
        <label className="label" htmlFor="c-message">Message</label>
        <textarea className="input min-h-32" id="c-message" name="message" required placeholder="Tell us about your catalog size, marketplaces and what you need help with." />
        {issues.message && <p className="mt-1 text-xs text-red-700">{issues.message}</p>}
      </div>
      {/* Honeypot — hidden from people, filled by bots. */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden defaultValue="" />
      {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      <button className="btn-primary" disabled={state === 'busy'}>{state === 'busy' ? 'Sending…' : 'Send message'}</button>
      <p className="text-xs text-ink-3">We use your details only to reply to this enquiry. See our Privacy Policy.</p>
    </form>
  );
}
