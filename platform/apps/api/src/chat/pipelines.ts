/**
 * Manager pipelines (owner, 8 Nov 2026): the manager follows a fixed, step-by-step pipeline per skill. It may phrase
 * its replies freely, but it only sees the CURRENT step and can only save that step's fields; the server decides when
 * a step is complete. Team steps are done by SOLLUNA staff (or the portal bot later) and advanced from the ops panel.
 */
import { config } from '../common/config';

export type Marketplace = 'AMAZON' | 'FLIPKART';
/** form = the client submitted a Listings & Mapping form (checked on the server). */
export type FieldKind = 'text' | 'secret' | 'otp' | 'confirm' | 'document' | 'form' | 'teamdocs';
export interface PipeField { key: string; label: string; kind: FieldKind; required?: boolean; pattern?: RegExp; hint?: string; generate?: 'password'; prefill?: string; /** document: files the client must upload during this run */ minDocs?: number; /** form: which Listings & Mapping form counts (default MAPPING) */ formKind?: 'MAPPING' | 'NEW_LISTING'; /** teamdocs: files the team must upload for the run's period, by document kind */ docKinds?: { kind: string; label: string }[] }
export interface PipeStep {
  key: string; title: string;
  /** Who completes the step: the client (through the manager) or the SOLLUNA team / bot. */
  by: 'client' | 'team';
  instructions: string; fields: PipeField[];
  /** After this step: when data[field] === equals, go back to `step` and clear the listed fields (e.g. marketplace asked for more info). */
  loop?: { field: string; equals: string; step: string; clear: string[] };
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

/**
 * New listings (owner, 9 Nov 2026): the client fills the New listing form; the team researches the top 100 keywords on
 * keywordtool.io (product name → copy the top 100) and creates the listing with the client's details + researched details.
 */
const CREATE_PATH: Record<Marketplace, string> = {
  FLIPKART: 'Seller Hub → Home → Listings → Add New Listing → Add Single Listing → Select The Vertical For Your Product → fill the vertical\'s form from the client\'s New listing form, complete the rest from research, Search Keywords = the researched keywords → send for QC',
  AMAZON: 'Seller Central → Home → Menu → Catalog → Add Products → "I\'m adding a product not sold on Amazon" → product type → fill from the client\'s New listing form, complete the rest from research; Search terms = search_terms (Amazon keeps them short), the other keywords go into title / bullet points where they read naturally → save and finish',
};
const newListing = (mp: Marketplace): PipeStep[] => [
  { key: 'listing_form', title: 'Client fills the New listing form', by: 'client',
    instructions: `Ask the client to open Listings & Mapping → ${mp === 'AMAZON' ? 'Amazon' : 'Flipkart'} → New listing and fill the form (product details, images, price, stock, tax, manufacturing). Whatever they do not know, SOLLUNA completes from research. The plan's monthly new-listing limit applies. When they say it is submitted, save form_submitted = yes — the server checks the form arrived.`,
    fields: [{ key: 'form_submitted', label: 'New listing form submitted', kind: 'form', required: true, formKind: 'NEW_LISTING', hint: `No ${mp === 'AMAZON' ? 'Amazon' : 'Flipkart'} new listing form has been submitted yet. Ask the client to submit it in Listings & Mapping first.` }] },
  { key: 'keywords', title: 'SOLLUNA researches the top 100 keywords', by: 'team',
    instructions: 'The team is researching search keywords for the product. Tell the client the listing is being prepared.',
    fields: [{ key: 'keywords', label: 'Top 100 keywords', kind: 'text', required: true, hint: 'keywordtool.io → Google (and the Amazon tab for Amazon listings) → type the product name → copy the top 100 keywords → paste here (one per line or comma-separated)' }] },
  { key: 'create', title: `SOLLUNA creates the listing on ${mp === 'AMAZON' ? 'Amazon' : 'Flipkart'}`, by: 'team',
    instructions: 'The team is creating the listing now. Tell the client it is in progress and you will confirm when the marketplace has checked it.',
    fields: [{ key: 'listing_ref', label: mp === 'AMAZON' ? 'SKU / ASIN' : 'SKU / Listing ID', kind: 'text', required: true, hint: CREATE_PATH[mp] }] },
  { key: 'live', title: `${mp === 'AMAZON' ? 'Amazon' : 'Flipkart'} checks the listing (${mp === 'AMAZON' ? 'processing' : 'QC'})`, by: 'team',
    instructions: 'The marketplace is checking the new listing. Tell the client you will update them as soon as it is live. Do not say it is live before the team confirms.',
    fields: [
      { key: 'outcome', label: 'Result', kind: 'text', required: true, pattern: /^(LIVE|ISSUE)$/, hint: mp === 'AMAZON' ? 'LIVE (active in Manage inventory) or ISSUE' : 'LIVE (QC Passed / active) or ISSUE (e.g. Listing Creation Error)' },
      { key: 'issue', label: 'Issue to fix (if any)', kind: 'text' },
    ] },
  { key: 'result', title: 'Tell the client the result', by: 'client',
    instructions: 'Tell the client the result (outcome, listing_ref). If LIVE: the new listing is active. If ISSUE: explain the issue simply and what is needed from them. Then save informed = yes.',
    fields: [{ key: 'informed', label: 'Client informed', kind: 'confirm', required: true }] },
];

/** Marketplace Support & Communication (owner, 9 Nov 2026): SOLLUNA raises and follows the seller-support ticket. */
const FK_TOPICS = ['Orders and logistics', 'Listings and catalog', 'Payments', 'Account', 'Inventory management', 'Seller performance', 'Returns and SPF', 'Other'];
const TICKET_PATH: Record<Marketplace, string> = {
  FLIPKART: 'Seller Hub → Home → Help → Help Center → search the topic → choose the issue → Raise a ticket → fill everything from the client\'s details → submit. Running tickets: Help Center → My Tickets',
  AMAZON: 'Seller Central → Home → Help → Get help and resources → choose the topic → raise the case (contact us) → fill everything from the client\'s details → submit. Running cases: Case log',
};
const marketplaceSupport = (mp: Marketplace): PipeStep[] => [
  { key: 'issue', title: 'Understand the issue', by: 'client',
    instructions: `Find out exactly what the problem is, one question at a time: what happened, since when, and the order ID / SKU / ${mp === 'AMAZON' ? 'ASIN' : 'FSN'} / payment or settlement reference if there is one. Ask for screenshots or documents if they help (upload here in chat). ${mp === 'FLIPKART' ? `Pick the Help Center topic (one of: ${FK_TOPICS.join(', ')}).` : 'Note the help topic it belongs to (orders, listings, payments, account, inventory, performance, returns, other).'} Account suspension, legal notices or money stuck for long: also escalate_to_team (P1).`,
    fields: [
      { key: 'topic', label: 'Help topic', kind: 'text', required: true, ...(mp === 'FLIPKART' ? { pattern: new RegExp(`^(${FK_TOPICS.join('|').toUpperCase()})$`), hint: FK_TOPICS.join(', ') } : {}) },
      { key: 'issue_summary', label: 'What is the issue', kind: 'text', required: true },
      { key: 'references', label: 'Order ID / SKU / FSN / ASIN / payment reference', kind: 'text' },
    ] },
  { key: 'raise', title: `SOLLUNA raises the ${mp === 'AMAZON' ? 'case' : 'ticket'} with ${mp === 'AMAZON' ? 'Amazon' : 'Flipkart'}`, by: 'team',
    instructions: 'The team is raising the ticket with the marketplace now. Tell the client it is being raised and you will share the ticket number.',
    fields: [{ key: 'ticket_id', label: mp === 'AMAZON' ? 'Amazon case ID' : 'Flipkart ticket ID', kind: 'text', required: true, hint: TICKET_PATH[mp] }] },
  { key: 'review', title: `${mp === 'AMAZON' ? 'Amazon' : 'Flipkart'} works on the ${mp === 'AMAZON' ? 'case' : 'ticket'}`, by: 'team',
    instructions: 'The marketplace is working on the ticket (ticket_id). Tell the client it is with the marketplace and you will update them as soon as there is a reply. Do not promise a result or a date.',
    fields: [
      { key: 'outcome', label: 'Marketplace reply', kind: 'text', required: true, pattern: /^(RESOLVED|NEEDS_INFO|CLOSED)$/, hint: 'RESOLVED, NEEDS_INFO (they asked for more) or CLOSED (not resolved)' },
      { key: 'marketplace_reply', label: 'What the marketplace said', kind: 'text', required: true },
    ] },
  { key: 'update', title: 'Update the client', by: 'client',
    instructions: 'Tell the client the marketplace\'s reply (outcome, marketplace_reply) in simple words. RESOLVED: confirm what was fixed. CLOSED (not resolved): explain why and the next option (escalate_to_team if needed). NEEDS_INFO: collect exactly what the marketplace asked for and save it as more_info — the team then replies on the same ticket. Then save informed = yes and call pipeline_next.',
    fields: [
      { key: 'more_info', label: 'Information the marketplace asked for', kind: 'text' },
      { key: 'informed', label: 'Client informed', kind: 'confirm', required: true },
    ],
    loop: { field: 'outcome', equals: 'NEEDS_INFO', step: 'review', clear: ['outcome', 'marketplace_reply', 'informed'] } },
];

/** CA documentation (owner, 10 Nov 2026): every month SOLLUNA downloads the previous month's tax files for the CA pack. */
const CA_FILES: Record<Marketplace, { kind: string; label: string }[]> = {
  FLIPKART: [{ kind: 'FLIPKART_GSTR_REPORT', label: 'GSTR return report' }, { kind: 'FLIPKART_SALES_REPORT', label: 'Sales report' }, { kind: 'FLIPKART_TDS', label: 'TDS report' }],
  AMAZON: [{ kind: 'AMAZON_MTR_B2B', label: 'Merchant Tax Report (MTR) B2B' }, { kind: 'AMAZON_MTR_B2C', label: 'Merchant Tax Report (MTR) B2C' }, { kind: 'AMAZON_FEE_INVOICE', label: 'Seller fee invoices (all of the month)' }],
};
const CA_PATH: Record<Marketplace, string> = {
  FLIPKART: 'Seller Hub → Home → Reports → Report Center → New Report → Tax Reports → request GSTR return report, Sales Report and TDS for the whole previous month (check the dates: 1st to last day) → download when ready → upload each here',
  AMAZON: 'Seller Central → Home → Finance → Manage taxes → GST Monthly Reports → Merchant Tax Report (MTR) B2B and B2C for the previous month; then Finance reports → Tax document library → Seller Fee Invoices → every invoice of the previous month → upload each here',
};
const caDocumentation = (mp: Marketplace): PipeStep[] => [
  { key: 'download', title: `SOLLUNA downloads the ${mp === 'AMAZON' ? 'Amazon' : 'Flipkart'} tax files for the month`, by: 'team',
    instructions: 'The team is collecting this month\'s marketplace tax files for the CA pack. If the client asks, tell them the files are being prepared.',
    fields: [{ key: 'files', label: 'Tax files uploaded', kind: 'teamdocs', required: true, docKinds: CA_FILES[mp], hint: CA_PATH[mp] }] },
  { key: 'deliver', title: 'Tell the client the CA files are ready', by: 'client',
    instructions: 'Tell the client the marketplace tax files for the period are ready in Reports → CA pack (and in Documents). Offer to send the pack to their CA: they can use "Request CA pack" in Reports with the CA\'s email. Then save informed = yes.',
    fields: [{ key: 'informed', label: 'Client informed', kind: 'confirm', required: true }] },
];

export const PIPELINES: Record<string, Pipeline> = {
  CA_DOCUMENTATION: { key: 'CA_DOCUMENTATION', title: 'CA documents for the month', branches: { FLIPKART_CA: caDocumentation('FLIPKART'), AMAZON_CA: caDocumentation('AMAZON') } },
  MARKETPLACE_SUPPORT: { key: 'MARKETPLACE_SUPPORT', title: 'Marketplace support ticket', branches: { FLIPKART_SUPPORT: marketplaceSupport('FLIPKART'), AMAZON_SUPPORT: marketplaceSupport('AMAZON') } },
  NEW_LISTING: { key: 'NEW_LISTING', title: 'New listing', branches: { FLIPKART_LISTING: newListing('FLIPKART'), AMAZON_LISTING: newListing('AMAZON') } },
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
  if (f.key === 'topic' && f.pattern) return t.toUpperCase();
  if (f.key === 'keywords') return keywordList(t).join(', ');
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

export const PIPELINE_KEYS = ['SELLER_ACCOUNT_REGISTRATION', 'BRAND_APPROVAL', 'CATALOG_MAPPING', 'NEW_LISTING', 'MARKETPLACE_SUPPORT', 'CA_DOCUMENTATION'] as const;

/** Keywords pasted from keywordtool.io: one per line or comma-separated → de-duplicated, top 100 kept, in order. */
export function keywordList(raw: string) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of raw.split(/[\n,;\t]+/).map((x) => x.trim().replace(/\s+/g, ' ').toLowerCase()).filter(Boolean)) if (!seen.has(k)) { seen.add(k); out.push(k); }
  return out.slice(0, 100);
}
/** Amazon search terms: unique words from the keywords (in rank order) within Amazon's 250-byte limit. */
export function amazonSearchTerms(keywords: string[], maxBytes = 250) {
  const words: string[] = [];
  for (const w of keywords.join(' ').split(' ')) {
    if (!w || words.includes(w)) continue;
    if (Buffer.byteLength([...words, w].join(' ')) > maxBytes) break;
    words.push(w);
  }
  return words.join(' ');
}
