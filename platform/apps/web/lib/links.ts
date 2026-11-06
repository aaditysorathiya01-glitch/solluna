/** Preview-only emailed links: open on whatever host is serving the app. */
export const relLink = (link: string) => { try { const u = new URL(link); return u.pathname + u.search; } catch { return link; } };
