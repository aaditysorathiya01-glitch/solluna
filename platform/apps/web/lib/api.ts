export class ApiError extends Error {
  constructor(public status: number, message: string, public issues?: { path: string; message: string }[]) { super(message); }
}

/** Browser-side API client. Same-origin (/api is proxied), session in an httpOnly cookie. */
export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? 'GET',
    headers: init.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: 'same-origin',
    cache: 'no-store',
  });
  const text = await res.text();
  let data: { message?: string | string[]; issues?: { path: string; message: string }[] } | null = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { message: res.ok ? undefined : 'Something went wrong. Please try again.' }; }
  if (!res.ok) {
    const msg = Array.isArray(data?.message) ? data.message.join(', ') : data?.message ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, msg, data?.issues);
  }
  return data as unknown as T;
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
