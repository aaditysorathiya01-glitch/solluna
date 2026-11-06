'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { relLink } from '@/lib/links';
import { api, ApiError } from '@/lib/api';
import { Logo } from './Logo';

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center"><Logo /></div>
        <div className="card space-y-4 p-7"><h1 className="font-display text-2xl">{title}</h1>{children}</div>
      </div>
    </main>
  );
}

const Err = ({ text }: { text: string | null }) => (text ? <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{text}</p> : null);

export function ForgotPassword() {
  const [sent, setSent] = useState<{ message: string; devLink?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError(null);
    try { setSent(await api('/auth/password/forgot', { method: 'POST', body: { email: new FormData(e.currentTarget).get('email') } })); }
    catch (err) { setError((err as ApiError).status === 429 ? 'Too many attempts — wait a minute and try again.' : (err as Error).message); }
    setBusy(false);
  }
  return (
    <Card title="Reset your password">
      {sent ? (
        <>
          <p role="status" className="text-sm text-ink-2">{sent.message} The link is valid for 30 minutes.</p>
          {sent.devLink && <p className="rounded-xl bg-sun/10 p-3 text-xs text-sun-3">Preview mode (no email connector): <a className="break-all underline" href={relLink(sent.devLink)}>open reset link</a></p>}
          <Link className="btn-ghost w-full" href="/login">Back to sign in</Link>
        </>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <p className="text-sm text-ink-3">Enter your account email and we&apos;ll send you a reset link.</p>
          <div><label className="label" htmlFor="email">Email</label><input className="input" id="email" name="email" type="email" autoComplete="email" required /></div>
          <Err text={error} />
          <button className="btn-primary w-full" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
          <p className="text-center text-sm"><Link className="text-ink-3 underline" href="/login">Back to sign in</Link></p>
        </form>
      )}
    </Card>
  );
}

export function ResetPassword() {
  const token = useSearchParams().get('token') ?? '';
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(null);
    const f = new FormData(e.currentTarget);
    if (f.get('password') !== f.get('confirm')) { setError('Passwords do not match'); return; }
    setBusy(true);
    try { await api('/auth/password/reset', { method: 'POST', body: { token, password: f.get('password') } }); setDone(true); }
    catch (err) { setError((err as Error).message); }
    setBusy(false);
  }
  if (!token) return <Card title="Reset link missing"><p className="text-sm text-ink-3">Open the link from your email, or request a new one.</p><Link className="btn-primary w-full" href="/forgot-password">Request a new link</Link></Card>;
  return (
    <Card title={done ? 'Password updated' : 'Choose a new password'}>
      {done ? (
        <><p role="status" className="text-sm text-ink-2">Your password has been changed and other sessions were signed out.</p><Link className="btn-primary w-full" href="/login">Sign in</Link></>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div><label className="label" htmlFor="password">New password (10+ characters)</label><input className="input" id="password" name="password" type="password" autoComplete="new-password" minLength={10} required /></div>
          <div><label className="label" htmlFor="confirm">Confirm password</label><input className="input" id="confirm" name="confirm" type="password" autoComplete="new-password" required /></div>
          <Err text={error} />
          <button className="btn-primary w-full" disabled={busy}>{busy ? 'Saving…' : 'Set new password'}</button>
        </form>
      )}
    </Card>
  );
}

export function VerifyEmail() {
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = useState<'working' | 'ok' | 'error'>('working');
  const [message, setMessage] = useState('');
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return; ran.current = true; // tokens are single use — never submit twice
    if (!token) { setState('error'); setMessage('Verification link is missing its token.'); return; }
    api<{ email: string }>('/auth/email/verify', { method: 'POST', body: { token } })
      .then((r) => { setState('ok'); setMessage(`${r.email} is verified.`); })
      .catch((e) => { setState('error'); setMessage((e as Error).message); });
  }, [token]);
  return (
    <Card title={state === 'ok' ? 'Email verified' : state === 'error' ? 'Could not verify' : 'Verifying…'}>
      <p role="status" className="text-sm text-ink-2">{message || 'One moment…'}</p>
      {state !== 'working' && <Link className="btn-primary w-full" href="/dashboard">Go to dashboard</Link>}
    </Card>
  );
}
