function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env ${name}`);
  return v;
}
const opt = (name: string) => process.env[name] || undefined;

export const config = {
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: req('JWT_SECRET'),
  jwtTtl: process.env.JWT_TTL ?? '12h',
  cookieSecure: process.env.COOKIE_SECURE !== 'false',
  razorpay: {
    keyId: opt('RAZORPAY_KEY_ID'),
    keySecret: opt('RAZORPAY_KEY_SECRET'),
    webhookSecret: opt('RAZORPAY_WEBHOOK_SECRET'),
    apiBase: process.env.RAZORPAY_API_BASE ?? 'https://api.razorpay.com',
  },
  /** SOLLUNA's own GST registration — printed on every tax invoice. Checkout is refused until set. */
  supplier: {
    legalName: opt('SUPPLIER_LEGAL_NAME'),
    tradeName: process.env.SUPPLIER_TRADE_NAME ?? 'SOLLUNA',
    gstin: opt('SUPPLIER_GSTIN')?.toUpperCase(),
    address: opt('SUPPLIER_ADDRESS'),
    email: opt('SUPPLIER_EMAIL'),
  },
  gstRateBps: Number(process.env.GST_RATE_BPS ?? 1800),
  /** SAC for the subscription service line. Confirm with your CA. */
  invoiceSac: process.env.INVOICE_SAC ?? '998399',
  graceDays: Number(process.env.GRACE_DAYS ?? 3),
  renewalReminderDays: Number(process.env.RENEWAL_REMINDER_DAYS ?? 3),
  /** Outbound event webhook (e.g. a Zapier "Catch Hook" that fans out to Gmail / Google Sheets). */
  connectorWebhookUrl: opt('CONNECTOR_WEBHOOK_URL'),
  connectorWebhookSecret: opt('CONNECTOR_WEBHOOK_SECRET'),
  /** Hosts accepted as delivery locations for task outputs (Google Drive connector by default). */
  approvedOutputHosts: (process.env.APPROVED_OUTPUT_HOSTS ?? 'drive.google.com,docs.google.com').split(',').map((s) => s.trim()),
  skillsDir: opt('SKILLS_DIR'),
  sweepIntervalMs: Number(process.env.SWEEP_INTERVAL_MS ?? 0),
};
