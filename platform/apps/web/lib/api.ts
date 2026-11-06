export class ApiError extends Error {
  constructor(public status: number, message: string, public issues?: { path: string; message: string }[]) { super(message); }
}

/** Gateway statuses returned while a sleeping server is starting (e.g. free hosting cold starts). */
const WAKING = [502, 503, 504];
const WAKING_MESSAGE = 'Our server is starting up — this can take up to a minute. Please try again shortly.';

/**
 * Browser-side API client. Same-origin (/api is proxied), session in an httpOnly cookie.
 * Gateway errors without a JSON body come from the hosting edge, before the app saw the request, so they are
 * retried for up to ~90 s; an app-level 503 (JSON, e.g. "payments not configured") is returned immediately.
 */
export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`/api${path}`, {
      method: init.method ?? 'GET',
      headers: init.body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      credentials: 'same-origin',
      cache: 'no-store',
    });
    const text = await res.text();
    let data: { message?: string | string[]; issues?: { path: string; message: string }[]; waking?: boolean } | null = null;
    let json = true;
    try { data = text ? JSON.parse(text) : null; } catch { json = false; }
    const waking = WAKING.includes(res.status) && (!json || data?.waking === true);
    if (waking && attempt < 18) { await new Promise((r) => setTimeout(r, 5000)); continue; }
    if (!json) data = { message: res.ok ? undefined : waking ? WAKING_MESSAGE : 'Something went wrong. Please try again.' };
    if (!res.ok) {
      const msg = Array.isArray(data?.message) ? data.message.join(', ') : data?.message ?? `Request failed (${res.status})`;
      throw new ApiError(res.status, msg, data?.issues);
    }
    return data as unknown as T;
  }
}

export const inr = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export const SECTION_LABEL: Record<string, string> = {
  ACCOUNT_CATALOG: 'Account & Catalog',
  REPORTING_SUPPORT: 'Reporting & Support',
  GROWTH_MANAGEMENT: 'Growth & Management',
  SHIPPING_BRANDING: 'Shipping & Branding',
  PREMIUM_BUSINESS: 'Premium Business Services',
};
export const SECTIONS = Object.keys(SECTION_LABEL);
