import type { NextRequest } from 'next/server';

/**
 * Same-origin proxy to the NestJS API. Resolved at RUNTIME from API_URL (next.config rewrites are
 * frozen at build time, which would break when the API address changes between environments).
 * Keeps the httpOnly session cookie first-party and avoids CORS entirely.
 */
export const dynamic = 'force-dynamic';

const FORWARD_REQ = ['content-type', 'cookie', 'authorization', 'x-razorpay-signature', 'x-ops-mail-secret', 'user-agent'];
// No content-length: fetch() transparently decompresses gzip/br upstream bodies, so the upstream length would truncate them.
const FORWARD_RES = ['content-type', 'content-disposition', 'cache-control', 'content-security-policy', 'x-content-type-options', 'set-cookie', 'retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining'];

async function proxy(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const base = process.env.API_URL ?? 'http://localhost:4000';
  const url = `${base}/api/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`;

  const headers = new Headers();
  for (const h of FORWARD_REQ) { const v = req.headers.get(h); if (v) headers.set(h, v); }
  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip');
  if (ip) headers.set('x-forwarded-for', ip);

  // Live streams (Server-Sent Events) stay open; everything else times out. Client disconnects propagate upstream.
  // 100 s covers an API cold start on free hosting (~50–60 s). Connection failures (API not accepting yet) are retried.
  const isStream = path[path.length - 1] === 'stream';
  const signal = isStream ? req.signal : AbortSignal.any([req.signal, AbortSignal.timeout(100_000)]);
  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.from(await req.arrayBuffer());

  let upstream: Response | undefined;
  for (let attempt = 0; !upstream; attempt++) {
    try {
      upstream = await fetch(url, { method: req.method, headers, body, redirect: 'manual', cache: 'no-store', signal });
    } catch {
      // Timed out: the API may have processed the request, so the browser must not replay it automatically.
      if (signal.aborted) return Response.json({ statusCode: 504, message: 'The server took too long to respond. Please check and try again.' }, { status: 504 });
      // Never connected: safe for the browser to retry (waking: true).
      if (attempt >= 5) return Response.json({ statusCode: 502, waking: true, message: 'Our server is starting up — this can take up to a minute. Please try again shortly.' }, { status: 502 });
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  const out = new Headers();
  for (const h of FORWARD_RES) {
    if (h === 'set-cookie') for (const c of upstream.headers.getSetCookie()) out.append('set-cookie', c);
    else { const v = upstream.headers.get(h); if (v) out.set(h, v); }
  }
  if (isStream) { out.set('cache-control', 'no-cache, no-transform'); out.set('x-accel-buffering', 'no'); }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export { proxy as GET, proxy as POST, proxy as PATCH, proxy as PUT, proxy as DELETE };
