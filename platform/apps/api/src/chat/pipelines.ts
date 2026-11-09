/**
 * Manager pipelines (owner, 8 Nov 2026): the manager follows a fixed, step-by-step pipeline per skill. It may phrase
 * its replies freely, but it only sees the CURRENT step and can only save that step's fields; the server decides when
 * a step is complete. Team steps are done by SOLLUNA staff (or the portal bot later) and advanced from the ops panel.
 */
import { config } from '../common/config';

export type Marketplace = 'AMAZON' | 'FLIPKART';
/** form = the client submitted a Listings & Mapping form (checked on the server). */
export type FieldKind = 'text' | 'secret' | 'otp' | 'confirm' | 'document' | 'form';
export interface PipeField { key: string; label: string; kind: FieldKind; required?: boolean; pattern?: RegExp; hint?: string; generate?: 'password'; prefill?: string; /** document: files the client must upload during this run */ minDocs?: number }
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
      { key: 'documents', label: 'GST certificate + cancelled cheque uploaded', kind: 'document', required: true, minDocs: 2, hint: 'Ask the client to upload the GST certificate and a cancelled cheque here in chat first.' },
    ] },
  { key: 'account_creation', title: 'Team completes the business details and opens the account', by: 'team',
    instructions: 'The team is submitting the business details. If an OTP or verification is needed, ask the client to send it here right away. Tell the client you will update them as soon as the account is open.',
    fields: [{ key: 'otp', label: 'OTP', kind: 'otp' }] },
  ...grantAdmin(mp),
  { key: 'password_change', title: 'Client changes the password', by: 'client',
    instructions: 'The account is open and SOLLUNA has admin access. Ask the client to change the account password now (Forgot password on the sign-in page, or Settings → Login settings). When they confirm, save password_changed = yes: the temporary password is then deleted from SOLLUNA.',
    fields: [{ key: 'password_changed', label: 'Password changed', kind: 'confirm', required: true }] },
];

/** Brand approval document requirements (owner, 9 Nov 2026 — Flipkart's own wording). */
export const BRAND_DOCS = {
  TMC: 'Trademark Certificate (TMC): issued by the government; proves ownership of the brand. It must 1) include the application number and brand name, 2) include the TM class that fits the vertical they want to sell in, 3) include the proprietor / seller name and address exactly as in their Flipkart seller account, 4) have a TM status that is valid on the date of the request.',
  BAL: 'Brand Authorization Letter (BAL): issued by the brand owner or their authorised company, allowing them to sell the products. It must 1) be on the granting company\'s letterhead with the brand name and issue date, 2) include their business name exactly as in their Flipkart seller account, 3) carry the signature and seal (if any) of the granting company. The brand\'s trademark (TM) number may also be needed on the letter.',
  INVOICE: 'Purchase invoice: issued by their supplier (manufacturer or distributor) when they bought the products. It must 1) have an invoice number and a date not older than one year, 2) show their name, address and GSTIN exactly as in their Flipkart seller account, 3) show the supplier\'s name, address and GSTIN, 4) describe the products with brand name, model name, price and quantity, 5) optionally carry the supplier\'s signature and seal.',
};
const FSN = /^[A-Z0-9]{16}$/;

const brandApprovalFlipkart: PipeStep[] = [
  { key: 'brand_details', title: 'Brand, a product of that brand, and which document they have', by: 'client',
    instructions: 'Ask which brand they want approval for and the FSN (or Flipkart link) of ANY product of that brand. Then explain the three documents Flipkart accepts — a Trademark Certificate (TMC), a Brand Authorization Letter (BAL) from the brand owner, or a purchase invoice from their supplier — and ask which one they have. Save doc_type as TMC, BAL or INVOICE.',
    fields: [
      { key: 'brand_name', label: 'Brand name', kind: 'text', required: true },
      { key: 'fsn', label: 'FSN of a product of the brand', kind: 'text', required: true, pattern: FSN, hint: '16-character FSN or a Flipkart product link' },
      { key: 'doc_type', label: 'Document type', kind: 'text', required: true, pattern: /^(TMC|BAL|INVOICE)$/, hint: 'TMC, BAL or INVOICE' },
    ] },
  { key: 'document', title: 'Client uploads the document; check it meets Flipkart\'s requirements', by: 'client',
    instructions: `Ask the client to upload the chosen document here in chat. Then go through the requirements of THAT document type (doc_type) with them, one or two points at a time, and ask them to confirm each one. If a point is not met, explain what to fix or suggest another document type. Save requirements_ok = yes only when every point is confirmed. Requirements — ${BRAND_DOCS.TMC} ${BRAND_DOCS.BAL} ${BRAND_DOCS.INVOICE}`,
    fields: [
      { key: 'document', label: 'Document uploaded', kind: 'document', required: true, minDocs: 1, hint: 'Ask the client to upload the document here in chat first.' },
      { key: 'requirements_ok', label: 'All requirements confirmed', kind: 'confirm', required: true },
    ] },
  { key: 'apply', title: 'SOLLUNA applies for brand approval on Flipkart', by: 'team',
    instructions: 'The team is applying on Flipkart now. Tell the client it is being submitted and you will share the request number.',
    fields: [{ key: 'request_id', label: 'Flipkart request ID', kind: 'text', required: true, hint: 'Seller Hub: Home → Listings → Add New Listings → search the FSN → Apply for Approval → choose the document type → upload → Apply' }] },
  { key: 'decision', title: 'Flipkart reviews the request', by: 'team',
    instructions: 'Flipkart is reviewing the request (request_id). Tell the client it is under review and you will update them as soon as Flipkart decides. Do not promise approval or a date.',
    fields: [
      { key: 'outcome', label: 'Flipkart decision', kind: 'text', required: true, pattern: /^(APPROVED|REJECTED)$/, hint: 'APPROVED or REJECTED' },
      { key: 'rejection_reason', label: 'Rejection reason (if rejected)', kind: 'text' },
    ] },
  { key: 'result', title: 'Tell the client the result', by: 'client',
    instructions: 'Tell the client Flipkart\'s decision (outcome). If APPROVED: they can now list this brand — offer to start the listing or mapping. If REJECTED: share rejection_reason in simple words and offer to apply again with another document (start_pipeline BRAND_APPROVAL again). Then save informed = yes.',
    fields: [{ key: 'informed', label: 'Client informed', kind: 'confirm', required: true }] },
];

const ASIN = /^[A-Z0-9]{10}$/;
/** Amazon India "Apply to sell" (owner, 9 Nov 2026): only purchase invoices; contact email = SOLLUNA, phone = client. */
const AMAZON_INVOICE_RULES = 'At least 1 purchase invoice for these products from a manufacturer or distributor. Each must 1) be dated on or after {{date-180}} (within 180 days), 2) include their name and address, 3) include the name and address of the manufacturer or distributor, 4) together show a combined purchase of at least 100 units. Pricing may be hidden (optional). Amazon may verify by contacting the vendor named on the invoice. Files: PDF, DOCX, PNG, GIF or JPG, up to 10 MB each.';
const brandApprovalAmazon: PipeStep[] = [
  { key: 'brand_details', title: 'Brand, an ASIN of that brand, and the contact phone', by: 'client',
    instructions: `Ask which brand they want approval for and the ASIN (or Amazon.in link) of ANY product of that brand. Amazon accepts purchase invoices only — tell them briefly what is needed: ${AMAZON_INVOICE_RULES} Confirm the phone number Amazon may call (contact_phone, the client's own number). SOLLUNA's email is given as the contact email.`,
    fields: [
      { key: 'brand_name', label: 'Brand name', kind: 'text', required: true },
      { key: 'asin', label: 'ASIN of a product of the brand', kind: 'text', required: true, pattern: ASIN, hint: '10-character ASIN or an Amazon.in product link' },
      { key: 'contact_phone', label: 'Client phone for Amazon', kind: 'text', required: true, pattern: /^[6-9]\d{9}$/, hint: '10-digit Indian mobile', prefill: 'org.contactPhone' },
    ] },
  { key: 'document', title: 'Client uploads purchase invoice(s); check Amazon\'s requirements', by: 'client',
    instructions: `Ask the client to upload the purchase invoice(s) here in chat. Then go through Amazon's requirements one or two at a time and ask them to confirm each: ${AMAZON_INVOICE_RULES} If a point is not met (older than 180 days, fewer than 100 units in total, missing addresses), explain what is needed. Save requirements_ok = yes only when every point is confirmed.`,
    fields: [
      { key: 'document', label: 'Invoice uploaded', kind: 'document', required: true, minDocs: 1, hint: 'Ask the client to upload the purchase invoice here in chat first.' },
      { key: 'requirements_ok', label: 'All requirements confirmed', kind: 'confirm', required: true },
    ] },
  { key: 'apply', title: 'SOLLUNA applies to sell the brand on Amazon', by: 'team',
    instructions: 'The team is submitting the application on Amazon now. Tell the client it is being submitted and that Amazon may call their number or contact the vendor.',
    fields: [{ key: 'request_id', label: 'Amazon application reference', kind: 'text', required: true, hint: `Seller Central: Home → Menu → Catalog → Add Products → search the ASIN → condition New → Apply to sell → upload invoice(s) → contact email ${config.opsUser.email}, phone = client's → tick all boxes → Submit. Enter the reference shown, or "submitted"` }] },
  { key: 'decision', title: 'Amazon reviews the application', by: 'team',
    instructions: 'Amazon is reviewing the application. Tell the client it is under review and you will update them as soon as Amazon decides. Do not promise approval or a date.',
    fields: [
      { key: 'outcome', label: 'Amazon decision', kind: 'text', required: true, pattern: /^(APPROVED|REJECTED)$/, hint: 'APPROVED or REJECTED' },
      { key: 'rejection_reason', label: 'Rejection reason (if rejected)', kind: 'text' },
    ] },
  { key: 'result', title: 'Tell the client the result', by: 'client',
    instructions: 'Tell the client Amazon\'s decision (outcome). If APPROVED: they can now list this brand — offer to start the listing or mapping. If REJECTED: share rejection_reason in simple words and offer to apply again with other invoices (start_pipeline BRAND_APPROVAL again). Then save informed = yes.',
    fields: [{ key: 'informed', label: 'Client informed', kind: 'confirm', required: true }] },
];

/** Unlimited Existing Catalog Mapping (owner, 9 Nov 2026): the client fills the Mapping form; the team maps it on the marketplace. */
const MAP_PATH: Record<Marketplace, string> = {
  FLIPKART: 'Seller Hub → Home → Listings → Add New Listing → paste the FSN in "Create listings using products available on Flipkart" → Start Selling → fill the details from the client\'s mapping form → submit',
  AMAZON: 'Seller Central → Home → Menu → Catalog → Add Products → search the ASIN → condition New → Sell this product (Apply to sell if the brand is gated — then run Brand Approval first) → fill the offer from the client\'s mapping form → submit',
};
const catalogMapping = (mp: Marketplace): PipeStep[] => [
  { key: 'mapping_form', title: 'Client fills the Mapping form for each product', by: 'client',
    instructions: `Ask the client to open Listings & Mapping → ${mp === 'AMAZON' ? 'Amazon' : 'Flipkart'} → Mapping, paste the product ${mp === 'AMAZON' ? 'ASIN or Amazon.in link' : 'FSN or Flipkart link'} and fill the form, one form per product (a saved template fills repeat products faster). Help with any field they are unsure about. When they say they have submitted, save forms_submitted = yes — the server checks the forms really arrived.`,
    fields: [{ key: 'forms_submitted', label: 'Mapping form(s) submitted', kind: 'form', required: true, hint: `No ${mp === 'AMAZON' ? 'Amazon' : 'Flipkart'} mapping form has been submitted yet. Ask the client to submit it in Listings & Mapping first.` }] },
  { key: 'map', title: `SOLLUNA maps the product(s) on ${mp === 'AMAZON' ? 'Amazon' : 'Flipkart'}`, by: 'team',
    instructions: 'The team is adding the client\'s offer to the existing product page(s) now. Tell the client it is in progress and you will confirm when it is live.',
    fields: [{ key: 'listing_refs', label: `${mp === 'AMAZON' ? 'SKU / ASIN' : 'SKU / Listing ID'} of each mapped product`, kind: 'text', required: true, hint: MAP_PATH[mp] }] },
  { key: 'live', title: `${mp === 'AMAZON' ? 'Amazon' : 'Flipkart'} confirms the listing(s)`, by: 'team',
    instructions: 'The marketplace is processing the listing (QC / activation). Tell the client you will update them as soon as it is live. Do not say it is live before the team confirms.',
    fields: [
      { key: 'outcome', label: 'Result', kind: 'text', required: true, pattern: /^(LIVE|ISSUE)$/, hint: 'LIVE (marketplace shows it active) or ISSUE' },
      { key: 'issue', label: 'Issue to fix (if any)', kind: 'text' },
    ] },
  { key: 'result', title: 'Tell the client the result', by: 'client',
    instructions: 'Tell the client the result (outcome, listing_refs). If LIVE: their offer is active on the existing product page. If ISSUE: explain the issue simply and what is needed from them; if it needs a new form, start the Catalog Mapping pipeline again. Then save informed = yes.',
    fields: [{ key: 'informed', label: 'Client informed', kind: 'confirm', required: true }] },
];

export const PIPELINES: Record<string, Pipeline> = {
  CATALOG_MAPPING: { key: 'CATALOG_MAPPING', title: 'Catalog mapping', branches: { FLIPKART_MAPPING: catalogMapping('FLIPKART'), AMAZON_MAPPING: catalogMapping('AMAZON') } },
  BRAND_APPROVAL: { key: 'BRAND_APPROVAL', title: 'Brand approval', branches: { FLIPKART_BRAND: brandApprovalFlipkart, AMAZON_BRAND: brandApprovalAmazon } },
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
  if (f.key === 'asin') return (/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i.exec(t)?.[1] ?? t).replace(/\s+/g, '').toUpperCase();
  if (f.key === 'contact_phone') return t.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
  if (f.key === 'fsn') return (/[?&]pid=([A-Z0-9]{16})/i.exec(t)?.[1] ?? t).replace(/\s+/g, '').toUpperCase();
  if (f.pattern) return t.replace(/\s+/g, '').toUpperCase();
  return t;
}
export function validate(f: PipeField, value: string): string | null {
  if (f.kind === 'confirm') return /^(yes|y|haan|ha|done|true|ok)$/i.test(value.trim()) ? null : `${f.label}: confirm with yes`;
  if (!value.trim()) return `${f.label} is empty`;
  if (f.pattern && !f.pattern.test(normalise(f, value))) return `${f.label} looks wrong${f.hint ? ` (${f.hint})` : ''}`;
  return null;
}

export const PIPELINE_KEYS = ['SELLER_ACCOUNT_REGISTRATION', 'BRAND_APPROVAL', 'CATALOG_MAPPING'] as const;
