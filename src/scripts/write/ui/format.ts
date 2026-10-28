// Human date/time formatting for the /write app.

export const SITE_HOST = 'benxie.garden';

const ymd = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(s);
};

/** 'YYYY-MM-DD' → 'Oct 27, 2026' */
export function fmtDate(s: string) {
  const d = ymd(s);
  if (isNaN(+d)) return s;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** ms → '2:41 PM' */
export const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

/** ms → '2:41 PM' today, otherwise 'Oct 25, 2:41 PM' (so an old local copy never looks fresh). */
export function fmtWhen(ms: number) {
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return fmtTime(ms);
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) }) + ', ' + fmtTime(ms);
}

/** ms → 'just now', '5 min ago', '3 hr ago', then fmtWhen. */
export function ago(ms: number) {
  const s = (Date.now() - ms) / 1000;
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 6 * 3600) return `${Math.round(s / 3600)} hr ago`;
  return fmtWhen(ms);
}

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Relative day for a post date ('YYYY-MM-DD') or an ISO timestamp. */
export function relDate(s: string, withTime = false) {
  const d = s.length <= 10 ? ymd(s) : new Date(s);
  if (isNaN(+d)) return s;
  const days = Math.round((dayStart(new Date()) - dayStart(d)) / 864e5);
  const time = withTime ? `, ${fmtTime(+d)}` : '';
  if (days === 0) return 'Today' + time;
  if (days === 1) return 'Yesterday' + time;
  if (days > 1 && days < 7) return `${days} days ago`;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

export const liveUrl = (slug: string) => `/blog/${slug}/`;
export const previewUrl = (slug: string) => `/blog/draft/${slug}/`;
export const prettyUrl = (slug: string) => `${SITE_HOST}/blog/${slug || '…'}`;
