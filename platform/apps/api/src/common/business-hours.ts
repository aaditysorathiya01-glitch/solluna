/**
 * SOLLUNA working hours (owner, 18 Nov 2026): Mon–Sat, 10 AM–7 PM IST. Manager hand-offs and chat replies wait for
 * the next opening; outside hours the client gets one short "we are closed" note. BUSINESS_HOURS=24x7 turns it off
 * (tests). Format: "<days> <HH:MM>-<HH:MM>", days 1=Mon … 7=Sun, e.g. "1-6 10:00-19:00".
 */
const IST_MS = 330 * 60_000;
const SPEC = process.env.BUSINESS_HOURS ?? '1-6 10:00-19:00';

function parse() {
  if (SPEC === '24x7' || SPEC === 'off') return null;
  const m = SPEC.match(/^(\d)-(\d) (\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
  if (!m) return { from: 1, to: 6, open: 600, close: 1140 };
  return { from: +m[1], to: +m[2], open: +m[3] * 60 + +m[4], close: +m[5] * 60 + +m[6] };
}
const H = parse();

/** IST weekday (1=Mon…7=Sun) and minutes since IST midnight. */
function ist(d: Date) {
  const t = new Date(d.getTime() + IST_MS);
  const day = t.getUTCDay() === 0 ? 7 : t.getUTCDay();
  return { day, min: t.getUTCHours() * 60 + t.getUTCMinutes(), midnightUtc: Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()) - IST_MS };
}

export function isOpen(d = new Date()) {
  if (!H) return true;
  const { day, min } = ist(d);
  return day >= H.from && day <= H.to && min >= H.open && min < H.close;
}

/** The next opening time (now if open). */
export function nextOpen(d = new Date()) {
  if (!H || isOpen(d)) return d;
  let { day, min, midnightUtc } = ist(d);
  for (let i = 0; i < 8; i++) {
    if (day >= H.from && day <= H.to && min < H.open) return new Date(midnightUtc + H.open * 60_000);
    midnightUtc += 86_400_000; day = day === 7 ? 1 : day + 1; min = -1;
  }
  return d;
}

/** "10:00 AM, Thu 19 Nov" in IST. */
export function openLabel(d: Date) {
  return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true, weekday: 'short', day: 'numeric', month: 'short' });
}

export const HOURS_TEXT = 'Mon–Sat, 10 AM–7 PM IST';
