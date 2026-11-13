'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { Logo } from './Logo';

type Field = { name: string; label: string; type?: string; required?: boolean; placeholder?: string; autoComplete?: string };

export function AuthForm({ mode, plan }: { mode: 'login' | 'register'; plan?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [needCode, setNeedCode] = useState(false);
  const [codeHelp, setCodeHelp] = useState<{ byEmail: boolean; text: string }>({ byEmail: false, text: '' });

  const fields: Field[] = mode === 'login'
    ? [{ name: 'email', label: 'Email', type: 'email', required: true, autoComplete: 'email' }, { name: 'password', label: 'Password', type: 'password', required: true, autoComplete: 'current-password' }]
    : [
        { name: 'name', label: 'Your name', required: true, autoComplete: 'name' },
        { name: 'email', label: 'Work email', type: 'email', required: true, autoComplete: 'email' },
        { name: 'phone', label: 'Mobile', type: 'tel', required: true, placeholder: '98XXXXXXXX', autoComplete: 'tel' },
        { name: 'password', label: 'Password (10+ characters)', type: 'password', required: true, autoComplete: 'new-password' },
        { name: 'confirmPassword', label: 'Confirm password', type: 'password', required: true, autoComplete: 'new-password' },
      ];

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError(null); setIssues({});
    const body: Record<string, unknown> = Object.fromEntries([...new FormData(e.currentTarget).entries()].filter(([, v]) => String(v).trim() !== ''));
    if (mode === 'register') {
      if (body.terms !== 'on') { setError('Please accept the Terms & Conditions and Privacy Policy'); setBusy(false); return; }
      if (body.password !== body.confirmPassword) { setIssues({ confirmPassword: 'Passwords do not match' }); setError('Passwords do not match'); setBusy(false); return; }
      delete body.terms; delete body.confirmPassword;
    }
    try {
      const r = await api<{ codeRequired?: boolean; message?: string }>(`/auth/${mode}`, { method: 'POST', body });
      if (mode === 'register' && r?.codeRequired) {
        // Email check before the account is created (owner, 13 Nov 2026).
        setCodeHelp({ byEmail: true, text: r.message ?? 'Enter the 6-digit code we emailed you.' });
        setNeedCode(true); setBusy(false);
        return;
      }
      const me = await api<{ user: { type: string } }>('/auth/me');
      router.push(me.user.type === 'STAFF' ? '/ops' : plan ? `/dashboard?plan=${plan}` : '/dashboard');
    } catch (err) {
      const a = err as ApiError;
      if (mode === 'register' && needCode && /expired/i.test(a.message)) setNeedCode(false); // next submit sends a new code
      if (a.status === 401 && /authenticator|code/i.test(a.message) && mode === 'login') {
        const byEmail = a.body?.method === 'email';
        setCodeHelp({ byEmail, text: byEmail ? a.message : 'Two-factor authentication is on for this account. Enter the 6-digit code from your authenticator app.' });
        const fresh = byEmail && /emailed/i.test(a.message);
        setError(needCode && !fresh ? a.message : null);
        // Expired code: the next "Sign in" sends a fresh one.
        setNeedCode(!(byEmail && /expired/i.test(a.message)));
        setBusy(false);
        return;
      }
      setError(a.message);
      if (a.issues) setIssues(Object.fromEntries(a.issues.map((i) => [i.path, i.message])));
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center"><Logo /></div>
        <form onSubmit={submit} className="card space-y-4 p-7" noValidate>
          <h1 className="font-display text-2xl">{mode === 'login' ? 'Sign in' : 'Create your seller account'}</h1>
          {plan && mode === 'register' && <p className="text-sm text-ink-3">You chose the <strong>{plan.charAt(0) + plan.slice(1).toLowerCase()}</strong> plan. You'll pay after creating your account.</p>}
          {fields.map((f) => (
            <div key={f.name}>
              <label className="label" htmlFor={f.name}>{f.label}</label>
              <input className="input" id={f.name} name={f.name} type={f.type ?? 'text'} required={f.required} placeholder={f.placeholder} autoComplete={f.autoComplete} />
              {issues[f.name] && <p className="mt-1 text-xs text-red-700">{issues[f.name]}</p>}
            </div>
          ))}
          {needCode && (
            <div>
              <label className="label" htmlFor="code">{codeHelp.byEmail ? 'Code from your email' : 'Authenticator code'}</label>
              <input className="input tracking-[0.4em]" id="code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" autoFocus required />
              <p className="mt-1 text-xs text-ink-3" data-testid="code-help">{codeHelp.text}</p>
              {mode === 'register' && <button type="button" className="mt-1 text-xs underline" onClick={(e) => { setNeedCode(false); setError(null); const f = e.currentTarget.form; setTimeout(() => f?.requestSubmit(), 0); }}>Send a new code</button>}
            </div>
          )}
          {mode === 'register' && (
            <label className="flex items-start gap-2 text-sm text-ink-3">
              <input type="checkbox" name="terms" className="mt-1 accent-[#C9962B]" />
              <span>I agree to the <Link className="underline" href="/terms" target="_blank">Terms &amp; Conditions</Link>, <Link className="underline" href="/privacy" target="_blank">Privacy Policy</Link> and <Link className="underline" href="/refund-policy" target="_blank">Refund &amp; Cancellation Policy</Link>.</span>
            </label>
          )}
          {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
          <button className="btn-primary w-full" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : needCode ? 'Verify & create account' : 'Create account'}</button>
          {mode === 'login' && <p className="text-center text-sm"><Link className="text-ink-3 underline hover:text-ink" href="/forgot-password">Forgot password?</Link></p>}
          <p className="text-center text-sm text-ink-3">
            {mode === 'login' ? <>New to SOLLUNA? <Link className="font-semibold text-ink underline" href="/register">Create an account</Link></> : <>Already registered? <Link className="font-semibold text-ink underline" href="/login">Sign in</Link></>}
          </p>
        </form>
      </div>
    </main>
  );
}
