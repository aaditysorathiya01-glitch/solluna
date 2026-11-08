/**
 * Manager pipelines (owner, 8 Nov 2026): the manager follows a fixed, step-by-step pipeline per skill. It may phrase
 * its replies freely, but it only sees the CURRENT step and can only save that step's fields; the server decides when
 * a step is complete. Team steps are done by SOLLUNA staff (or the portal bot later) and advanced from the ops panel.
 */
import { config } from '../common/config';

export type Marketplace = 'AMAZON' | 'FLIPKART';
export type FieldKind = 'text' | 'secret' | 'otp' | 'confirm' | 'document';
export interface PipeField { key: string; label: string; kind: FieldKind; required?: boolean; pattern?: RegExp; hint?: string; generate?: 'password'; prefill?: string }
export interface PipeStep {
  key: string; title: string;
  /** Who completes the step: the client (through the manager) or the SOLLUNA team / bot. */
  by: 'client' | 'team';
  instructions: string; fields: PipeField[];
}
export interface Pipeline { key: string; title: string; branches: Record<string, PipeStep[]> }

const ops = config.opsUser;
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN = /^[A-Z]{5}\d{4}[A-Z]$/;
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const MOBILE = /^(\+91)?[6-9]\d{9}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PIN = /^\d{6}$/;

const ADMIN_PATH: Record<Marketplace, string> = {
  FLIPKART: `Flipkart Seller Hub: Home → Profile → Manage Users → New User. Fill Name "${ops.name}", Email "${ops.email}"${ops.phone ? `, Phone "${ops.phone}"` : ''}, Role "${ops.role}", then save.`,
  AMAZON: `Amazon Seller Central (India): Home → Settings → Manage permissions → Action → Invite employee. Invite "${ops.email}" (name "${ops.name}"). After SOLLUNA accepts, the client clicks Confirm next to SOLLUNA and gives Admin (or View & Edit) permissions; bank / payment sections are not needed.`,
};

const grantAdmin = (mp: Marketplace): PipeStep[] => [
  { key: 'grant_admin', title: 'Client adds SOLLUNA as admin user', by: 'client',
    instructions: `Walk the client through giving SOLLUNA admin access, one step at a time: ${ADMIN_PATH[mp]} Never ask for their password or OTP in this step. When they say the invite is sent, save invite_sent = yes.`,
    fields: [{ key: 'invite_sent', label: 'Invite sent', kind: 'confirm', required: true }] },
  { key: 'verify_access', title: 'SOLLUNA accepts the invite and verifies access', by: 'team',
    instructions: 'The team is accepting the invite and checking access. Tell the client it is being verified and you will confirm shortly. Do not ask for anything else in this step.', fields: [] },
];

const CHECKLIST: Record<Marketplace, string> = {
  FLIPKART: 'Mobile number and email (both get an OTP), a password (or we create a temporary one), PAN, GSTIN, business / legal name, bank account number + IFSC + account holder name, pickup address with PIN, GST certificate and a cancelled cheque (upload here in chat).',
  AMAZON: 'Mobile number and email (both get an OTP), a password (or we create a temporary one), PAN, GSTIN, business / legal name, store display name, bank account number + IFSC + account holder name, pickup address with PIN, GST certificate and a cancelled cheque (upload here in chat). Amazon may also ask for an ID check (Aadhaar / video call) that only the client can do.',
};

const registration = (mp: Marketplace): PipeStep[] => [
  { key: 'checklist', title: 'Send the list of what is needed', by: 'client',
    instructions: `Send the client this list in short chat lines, then save list_sent = yes: ${CHECKLIST[mp]} Say the account will be in their own name, mobile and email.`,
    fields: [{ key: 'list_sent', label: 'List sent', kind: 'confirm', required: true }] },
  { key: 'login_details', title: `${mp === 'AMAZON' ? 'Amazon' : 'Flipkart'} sign-up page: mobile, email, password`, by: 'client',
    instructions: 'Collect the client\'s own mobile number and email for the sign-up page, one at a time. Password: if the client wants to choose one, ask them to type it as "password: <their password>" (it is stored encrypted and hidden from chat); if not, call generate_temp_password. Use facts already saved instead of asking again.',
    fields: [
      { key: 'mobile', label: 'Mobile number', kind: 'text', required: true, pattern: MOBILE, hint: '10-digit Indian mobile' },
      { key: 'email', label: 'Email ID', kind: 'text', required: true, pattern: EMAIL },
      { key: 'password', label: 'Password', kind: 'secret', required: true, generate: 'password' },
    ] },
  { key: 'login_otp', title: 'Team fills the sign-up page; client sends the OTPs', by: 'team',
    instructions: 'The team is filling the sign-up page now. Tell the client they will get OTPs on their mobile and email in a minute and should send them here as soon as they arrive. OTPs are passed to the team automatically and deleted after use.',
    fields: [{ key: 'otp', label: 'OTP', kind: 'otp' }] },
  { key: 'business_details', title: 'Business details page: PAN, GST, bank, address', by: 'client',
    instructions: 'Collect the business details one item at a time, using facts already saved (GSTIN, legal name, address) instead of asking again. Ask them to upload the GST certificate and a cancelled cheque here in chat with the attachment button.',
    fields: [
      { key: 'legal_name', label: 'Business / legal name', kind: 'text', required: true, prefill: 'org.legalName' },
      ...(mp === 'AMAZON' ? [{ key: 'store_name', label: 'Store display name', kind: 'text' as const, required: true, prefill: 'org.brandName' }] : []),
      { key: 'pan', label: 'PAN', kind: 'text', required: true, pattern: PAN },
      { key: 'gstin', label: 'GSTIN', kind: 'text', required: true, pattern: GSTIN, prefill: 'org.gstin' },
      { key: 'bank_account', label: 'Bank account number', kind: 'secret', required: true },
      { key: 'ifsc', label: 'IFSC', kind: 'text', required: true, pattern: IFSC },
      { key: 'account_holder', label: 'Account holder name', kind: 'text', required: true },
      { key: 'pickup_address', label: 'Pickup address', kind: 'text', required: true, prefill: 'org.address' },
      { key: 'pickup_pincode', label: 'Pickup PIN code', kind: 'text', required: true, pattern: PIN, prefill: 'org.pincode' },
      { key: 'documents', label: 'GST certificate + cancelled cheque uploaded', kind: 'document', required: true },
    ] },
  { key: 'account_creation', title: 'Team completes the business details and opens the account', by: 'team',
    instructions: 'The team is submitting the business details. If an OTP or verification is needed, ask the client to send it here right away. Tell the client you will update them as soon as the account is open.',
    fields: [{ key: 'otp', label: 'OTP', kind: 'otp' }] },
  ...grantAdmin(mp),
  { key: 'password_change', title: 'Client changes the password', by: 'client',
    instructions: 'The account is open and SOLLUNA has admin access. Ask the client to change the account password now (Forgot password on the sign-in page, or Settings → Login settings). When they confirm, save password_changed = yes: the temporary password is then deleted from SOLLUNA.',
    fields: [{ key: 'password_changed', label: 'Password changed', kind: 'confirm', required: true }] },
];

export const PIPELINES: Record<string, Pipeline> = {
  SELLER_ACCOUNT_REGISTRATION: {
    key: 'SELLER_ACCOUNT_REGISTRATION', title: 'Seller account (registration or admin access)',
    branches: {
      FLIPKART_HAS_ACCOUNT: grantAdmin('FLIPKART'), AMAZON_HAS_ACCOUNT: grantAdmin('AMAZON'),
      FLIPKART_NEW: registration('FLIPKART'), AMAZON_NEW: registration('AMAZON'),
    },
  },
};

export const stepsOf = (pipeline: string, branch: string) => PIPELINES[pipeline]?.branches[branch] ?? [];
/** Normalised value: emails lower-case, mobile / PIN digits only, IDs upper-case without spaces. */
export function normalise(f: PipeField, v: string) {
  const t = v.trim();
  if (f.key === 'email') return t.toLowerCase();
  if (f.key === 'mobile') return t.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
  if (f.key.endsWith('pincode')) return t.replace(/\D/g, '');
  if (f.pattern) return t.replace(/\s+/g, '').toUpperCase();
  return t;
}
export function validate(f: PipeField, value: string): string | null {
  if (f.kind === 'confirm') return /^(yes|y|haan|ha|done|true|ok)$/i.test(value.trim()) ? null : `${f.label}: confirm with yes`;
  if (!value.trim()) return `${f.label} is empty`;
  if (f.pattern && !f.pattern.test(normalise(f, value))) return `${f.label} looks wrong${f.hint ? ` (${f.hint})` : ''}`;
  return null;
}
