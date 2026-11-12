/**
 * SOLLUNA ops mailbox Worker (Cloudflare Email Routing → "Send to a Worker" for ops@solluna.co.in).
 * 1. Forwards every message to the ops Gmail so nothing is lost.
 * 2. Posts the raw message to SOLLUNA, which stores OTPs encrypted for 10 minutes (never shown to the model).
 * Only one setting is required: the Secret OPS_MAIL_SECRET (same value as OPS_MAIL_INBOUND_SECRET on the server).
 * Optional: SOLLUNA_URL, FORWARD_TO.
 */
export default {
  async email(message, env) {
    const url = (env.SOLLUNA_URL || 'https://solluna-preview.onrender.com').replace(/\/$/, '');
    const to = env.FORWARD_TO || 'solluna.ops@gmail.com';
    const raw = await new Response(message.raw).text();
    try { await message.forward(to); console.log('forwarded to', to); } catch (e) { console.error('forward failed', String(e)); }
    if (!env.OPS_MAIL_SECRET) { console.error('OPS_MAIL_SECRET is missing: add it under Settings → Variables and Secrets'); return; }
    try {
      const res = await fetch(`${url}/api/ops-mail/inbound`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-ops-mail-secret': env.OPS_MAIL_SECRET },
        body: JSON.stringify({ raw: raw.slice(0, 95_000) }), // stays under the API's 100 kB JSON limit
      });
      console.log('SOLLUNA inbound', res.status, await res.text());
    } catch (e) { console.error('SOLLUNA unreachable', String(e)); }
  },
};
