/**
 * Runs once when the Next.js server starts. On free hosting both services sleep when idle; waking the API
 * here, in parallel with the web server, halves the first visitor's wait. Harmless everywhere else.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const base = process.env.API_URL ?? 'http://localhost:4000';
  fetch(`${base}/api/health`, { cache: 'no-store', signal: AbortSignal.timeout(100_000) }).catch(() => undefined);
}
