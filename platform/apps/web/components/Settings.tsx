'use client';
import { useState } from 'react';
import { relLink } from '@/lib/links';
import { api } from '@/lib/api';
import { errText, formBody, type FlashMsg } from './ui';

export interface MeFull {
  user: { id: string; name: string; email: string; type: string; staffRole: string | null; phone: string | null; emailVerified: boolean; twoFactorEnabled: boolean; twoFactorRequired: boolean };
  organization: { id: string; legalName: string; brandName: string | null; gstin: string | null; pan: string | null; category: string | null; contactEmail: string; contactPhone: string } | null;
}

type Done = (m: FlashMsg) => void;

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="card space-y-4 p-6">
      <div><h2 className="font-semibold">{title}</h2>{sub && <p className="text-xs text-ink-3">{sub}</p>}</div>
      {children}
    </section>
  );
}

function useSubmit(onDone: Done) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true); setError(null);
    try { await fn(); onDone({ kind: 'ok', text: ok }); } catch (e) { setError(errText(e)); }
    setBusy(false);
  }
  return { busy, error, run };
}

const Err = ({ e }: { e: string | null }) => (e ? <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">{e}</p> : null);

export function AccountSettings({ me, onDone }: { me: MeFull; onDone: Done }) {
  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl">Account settings</h1>
      <EmailVerification me={me} onDone={onDone} />
      <ProfileForm me={me} onDone={onDone} />
      {me.organization && <BusinessForm me={me} onDone={onDone} />}
      <PasswordForm onDone={onDone} />
      <TwoFactor me={me} onDone={onDone} />
    </div>
  );
}

function EmailVerification({ me, onDone }: { me: MeFull; onDone: Done }) {
  const [link, setLink] = useState<string | null>(null);
  const s = useSubmit(onDone);
  if (me.user.emailVerified) return <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900">✓ {me.user.email} is verified.</p>;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-sun/10 px-4 py-3 text-sm">
      <span>Verify <strong>{me.user.email}</strong> so we can send invoices, reports and security alerts.</span>
      <button className="btn-ghost py-1.5 text-xs" disabled={s.busy} onClick={() => s.run(async () => { const r = await api<{ devLink?: string }>('/auth/email/verify-request', { method: 'POST' }); setLink(r.devLink ?? null); }, 'Verification email sent. Open the link in it to confirm.')}>Send verification email</button>
      {link && <p className="w-full text-xs text-sun-3">Preview mode (no email connector): <a className="underline" href={relLink(link)}>open verification link</a></p>}
      <Err e={s.error} />
    </div>
  );
}

function ProfileForm({ me, onDone }: { me: MeFull; onDone: Done }) {
  const s = useSubmit(onDone);
  return (
    <Section title="Your profile" sub="Your sign-in email cannot be changed here — contact SOLLUNA if you need to move the account to another email.">
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); const b = formBody(e.currentTarget); s.run(() => api('/auth/profile', { method: 'PATCH', body: b }), 'Profile saved.'); }}>
        <div><label className="label" htmlFor="p-name">Name</label><input id="p-name" name="name" className="input" defaultValue={me.user.name} required /></div>
        <div><label className="label" htmlFor="p-phone">Mobile</label><input id="p-phone" name="phone" className="input" defaultValue={me.user.phone?.replace('+91', '') ?? ''} inputMode="tel" /></div>
        <div className="sm:col-span-2"><label className="label">Email</label><p className="text-sm">{me.user.email}</p></div>
        <div className="sm:col-span-2"><Err e={s.error} /><button className="btn-primary" disabled={s.busy}>{s.busy ? 'Saving…' : 'Save profile'}</button></div>
      </form>
    </Section>
  );
}

function BusinessForm({ me, onDone }: { me: MeFull; onDone: Done }) {
  const o = me.organization!;
  const s = useSubmit(onDone);
  return (
    <Section title="Business details" sub="Used for onboarding, marketplace submissions and your manager's records. GSTIN and billing address are edited in Billing because they print on your tax invoice.">
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); const b = formBody(e.currentTarget); s.run(() => api('/account/organization', { method: 'PATCH', body: b }), 'Business details saved.'); }}>
        <div><label className="label" htmlFor="b-legal">Registered business name</label><input id="b-legal" name="legalName" className="input" defaultValue={o.legalName} required /></div>
        <div><label className="label" htmlFor="b-brand">Brand name</label><input id="b-brand" name="brandName" className="input" defaultValue={o.brandName ?? ''} /></div>
        <div><label className="label" htmlFor="b-cat">Main product category</label><input id="b-cat" name="category" className="input" defaultValue={o.category ?? ''} placeholder="e.g. Home & Kitchen" /></div>
        <div><label className="label" htmlFor="b-pan">PAN</label><input id="b-pan" name="pan" className="input uppercase" defaultValue={o.pan ?? ''} placeholder={o.gstin ? o.gstin.slice(2, 12) : 'ABCDE1234F'} /></div>
        <div><label className="label" htmlFor="b-email">Business email</label><input id="b-email" name="contactEmail" type="email" className="input" defaultValue={o.contactEmail} /></div>
        <div><label className="label" htmlFor="b-phone">Business mobile</label><input id="b-phone" name="contactPhone" className="input" defaultValue={o.contactPhone.replace('+91', '')} /></div>
        <div className="sm:col-span-2"><Err e={s.error} /><button className="btn-primary" disabled={s.busy}>{s.busy ? 'Saving…' : 'Save business details'}</button></div>
      </form>
    </Section>
  );
}

function PasswordForm({ onDone }: { onDone: Done }) {
  const s = useSubmit(onDone);
  return (
    <Section title="Change password" sub="Changing your password signs you out on every other device.">
      <form className="grid gap-3 sm:grid-cols-3" onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget; const b = formBody(form);
        if (b.newPassword !== b.confirm) { onDone({ kind: 'err', text: 'New passwords do not match' }); return; }
        s.run(async () => { await api('/auth/password/change', { method: 'POST', body: { currentPassword: b.currentPassword, newPassword: b.newPassword } }); form.reset(); }, 'Password changed. Other sessions have been signed out.');
      }}>
        <div><label className="label" htmlFor="pw-cur">Current password</label><input id="pw-cur" name="currentPassword" type="password" className="input" autoComplete="current-password" required /></div>
        <div><label className="label" htmlFor="pw-new">New password</label><input id="pw-new" name="newPassword" type="password" className="input" autoComplete="new-password" minLength={10} required /></div>
        <div><label className="label" htmlFor="pw-conf">Confirm new password</label><input id="pw-conf" name="confirm" type="password" className="input" autoComplete="new-password" required /></div>
        <div className="sm:col-span-3"><Err e={s.error} /><button className="btn-primary" disabled={s.busy}>{s.busy ? 'Saving…' : 'Change password'}</button></div>
      </form>
    </Section>
  );
}

/** TOTP enrolment. Mandatory for super admins (they land here until it is on), optional for everyone else. */
export function TwoFactor({ me, onDone, forced = false }: { me: MeFull; onDone: Done; forced?: boolean }) {
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [enabled, setEnabled] = useState(me.user.twoFactorEnabled);
  const s = useSubmit(onDone);
  const grouped = setup?.secret.match(/.{1,4}/g)?.join(' ');
  return (
    <Section title="Two-factor authentication" sub={forced ? 'Required for super admin accounts before the admin console opens.' : 'Adds a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, Authy) at sign-in.'}>
      {enabled ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-emerald-800">✓ Two-factor authentication is on.</p>
          {!me.user.twoFactorRequired && me.user.staffRole !== 'SUPER_ADMIN' && (
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const b = formBody(e.currentTarget); s.run(async () => { await api('/auth/2fa/disable', { method: 'POST', body: b }); setEnabled(false); }, 'Two-factor authentication turned off.'); }}>
              <input name="code" className="input w-32" inputMode="numeric" placeholder="Code" aria-label="Current code to turn off" required />
              <button className="btn-ghost py-1.5 text-xs" disabled={s.busy}>Turn off</button>
            </form>
          )}
        </div>
      ) : !setup ? (
        <button className="btn-primary" disabled={s.busy} onClick={() => s.run(async () => setSetup(await api('/auth/2fa/setup', { method: 'POST' })), 'Scan or enter the key in your authenticator app, then enter the code it shows.')}>Set up two-factor authentication</button>
      ) : (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); const b = formBody(e.currentTarget); s.run(async () => { await api('/auth/2fa/enable', { method: 'POST', body: b }); setEnabled(true); }, 'Two-factor authentication is on. You will need a code each time you sign in.'); }}>
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>Open your authenticator app and choose <strong>Add account → Enter a setup key</strong> (or tap the link on your phone).</li>
            <li>Account: <strong>SOLLUNA</strong>, key: <code className="rounded bg-ivory px-2 py-1 font-mono text-sm tracking-wider" data-testid="totp-secret">{grouped}</code>, type: time-based.</li>
            <li>Enter the 6-digit code the app shows.</li>
          </ol>
          <a className="text-xs underline" href={setup.otpauthUrl}>Open in authenticator app (on this phone)</a>
          <div className="flex gap-2">
            <input name="code" className="input w-40 tracking-[0.3em]" inputMode="numeric" maxLength={6} placeholder="123456" aria-label="Authenticator code" required autoFocus />
            <button className="btn-primary" disabled={s.busy}>{s.busy ? 'Checking…' : 'Confirm'}</button>
          </div>
        </form>
      )}
      <Err e={s.error} />
    </Section>
  );
}
