// JSON pointers (RFC 6901) and the "file:/pointer" keys used by data-edit markers.

export type Key = string; // "home:/paragraphs/1"
export const FILE_RE = /^[a-z0-9][a-z0-9-]*$/;

/** "home:/paragraphs/1" → { file: 'home', ptr: '/paragraphs/1' }, or null if malformed. */
export function parseKey(k: string | null | undefined): { file: string; ptr: string } | null {
  if (!k) return null;
  const i = k.indexOf(':');
  if (i < 1) return null;
  const file = k.slice(0, i), ptr = k.slice(i + 1);
  if (!FILE_RE.test(file) || !(ptr === '' || ptr.startsWith('/'))) return null;
  return { file, ptr };
}

export const tokens = (p: string) => (p === '' ? [] : p.slice(1).split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~')));

const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const index = (arr: unknown[], k: string) => (/^(0|[1-9]\d*)$/.test(k) && +k < arr.length ? +k : -1);

export function getPtr(root: unknown, p: string): unknown {
  let cur: any = root;
  for (const k of tokens(p)) {
    if (cur === null || typeof cur !== 'object') return undefined;
    if (Array.isArray(cur)) { const i = index(cur, k); if (i < 0) return undefined; cur = cur[i]; }
    else { if (!own(cur, k)) return undefined; cur = cur[k]; }
  }
  return cur;
}

/** Replace an EXISTING string value (never creates keys). Returns false when the pointer doesn't lead to a string. */
export function setPtr(root: unknown, p: string, v: string): boolean {
  const t = tokens(p);
  if (!t.length) return false;
  const parent = getPtr(root, '/' + t.slice(0, -1).map((s) => s.replace(/~/g, '~0').replace(/\//g, '~1')).join('/')) as any;
  const last = t[t.length - 1];
  const hold = t.length === 1 ? root as any : parent;
  if (hold === null || typeof hold !== 'object') return false;
  if (Array.isArray(hold)) { const i = index(hold, last); if (i < 0 || typeof hold[i] !== 'string') return false; hold[i] = v; return true; }
  if (!own(hold, last) || typeof hold[last] !== 'string') return false;
  hold[last] = v;
  return true;
}

/** Re-serialize like the original file: same indent and trailing newline. */
export function serialize(data: unknown, original: string): string {
  const m = /^([ \t]+)"/m.exec(original);
  const indent = m ? m[1] : 2;
  return JSON.stringify(data, null, indent) + (original.endsWith('\n') || !original ? '\n' : '');
}

/** "experience:/jobs/0/role" → "experience.json › jobs › 1 › role" (indices shown from 1). */
export function prettyKey(k: Key): string {
  const pk = parseKey(k);
  if (!pk) return k;
  return [`${pk.file}.json`, ...tokens(pk.ptr).map((s) => (/^\d+$/.test(s) ? String(+s + 1) : s))].join(' › ');
}
