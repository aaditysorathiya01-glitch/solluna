/**
 * SOLLUNA ops mailbox Worker (Cloudflare Email Routing → "Send to a Worker" for ops@solluna.co.in).
 * 1. Forwards every message to the ops Gmail (FORWARD_TO, a verified destination) so nothing is lost.
 * 2. Posts the raw message to SOLLUNA, which stores OTPs encrypted for 10 minutes (never shown to the model).
 * Worker settings → Variables: SOLLUNA_URL (e.g. https://app.solluna.co.in), FORWARD_TO (solluna.ops@gmail.com),
 * and the secret OPS_MAIL_SECRET (same value as OPS_MAIL_INBOUND_SECRET on the server; at least 24 characters).
 */
export default {
  async email(message, env) {
    const raw = await new Response(message.raw).text();
    try { await message.forward(env.FORWARD_TO); } catch (e) { console.log('forward failed', String(e)); }
    try {
      const res = await fetch(`${env.SOLLUNA_URL.replace(/\/$/, '')}/api/ops-mail/inbound`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-ops-mail-secret': env.OPS_MAIL_SECRET },
        body: JSON.stringify({ raw: raw.slice(0, 95_000) }), // stays under the API's 100 kB JSON limit
      });
      if (!res.ok) console.log('SOLLUNA inbound', res.status);
    } catch (e) { console.log('SOLLUNA unreachable', String(e)); }
  },
};
