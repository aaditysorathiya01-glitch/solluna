import type { NextRequest } from 'next/server';

/**
 * Same-origin proxy to the NestJS API. Resolved at RUNTIME from API_URL (next.config rewrites are
 * frozen at build time, which would break when the API address changes between environments).
 * Keeps the httpOnly session cookie first-party and avoids CORS entirely.
 */
export const dynamic = 'force-dynamic';

const FORWARD_REQ = ['content-type', 'cookie', 'authorization', 'x-razorpay-signature', 'user-agent'];
const FORWARD_RES = ['content-type', 'content-length', 'content-disposition', 'cache-control', 'content-security-policy', 'x-content-type-options', 'set-cookie', 'retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining'];

async function proxy(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const base = process.env.API_URL ?? 'http://localhost:4000';
  const url = `${base}/api/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`;

  const headers = new Headers();
  for (const h of FORWARD_REQ) { const v = req.headers.get(h); if (v) headers.set(h, v); }
  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip');
  if (ip) headers.set('x-forwarded-for', ip);

  // Live streams (Server-Sent Events) stay open; everything else times out. Client disconnects propagate upstream.
  const isStream = path[path.length - 1] === 'stream';
  const signal = isStream ? req.signal : AbortSignal.any([req.signal, AbortSignal.timeout(30_000)]);

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.from(await req.arrayBuffer()),
      redirect: 'manual',
      cache: 'no-store',
      signal,
    });
  } catch {
    return Response.json({ statusCode: 502, message: 'Service temporarily unavailable. Please try again.' }, { status: 502 });
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
