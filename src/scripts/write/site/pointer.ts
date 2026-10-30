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

// ---------- v2: structure ----------
export const escTok = (s: string | number) => String(s).replace(/~/g, '~0').replace(/\//g, '~1');
/** Pointer + more tokens: join('/jobs', 2, 'role') → '/jobs/2/role'. */
export const join = (p: string, ...t: (string | number)[]) => p + t.map((x) => '/' + escTok(x)).join('');
/** '/jobs/2/role' → { parent: '/jobs/2', last: 'role' }; '' has no parent. */
export function split(p: string): { parent: string; last: string } | null {
  const t = tokens(p);
  if (!t.length) return null;
  return { parent: join('', ...t.slice(0, -1)), last: t[t.length - 1] };
}
export const isIndex = (s: string) => /^(0|[1-9]\d*)$/.test(s);
/** p is q or inside q ('/jobs/2/role' under '/jobs/2'). */
export const under = (p: string, q: string) => p === q || p.startsWith(q + '/');
export const keyOf = (file: string, ptr: string): Key => `${file}:${ptr}`;
export const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
export function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) { const bb = b as unknown[]; return a.length === bb.length && a.every((x, i) => equal(x, bb[i])); }
  const ka = Object.keys(a as object), kb = Object.keys(b as object);
  return ka.length === kb.length && ka.every((k) => own(b as object, k) && equal((a as any)[k], (b as any)[k]));
}

/**
 * Set any value at p (undefined deletes an object key). A missing key is created in schema
 * order: after the nearest earlier key in `order` that exists, else before the nearest later
 * one, else last. Array slots must exist. Returns false when the parent isn't there.
 */
export function putPtr(root: unknown, p: string, v: unknown, order?: string[] | null): boolean {
  const s = split(p);
  if (!s) return false;
  const hold = getPtr(root, s.parent) as any;
  if (hold === null || typeof hold !== 'object') return false;
  if (Array.isArray(hold)) {
    const i = index(hold, s.last);
    if (i < 0 || v === undefined) return false;
    hold[i] = v;
    return true;
  }
  const k = s.last;
  if (v === undefined) { delete hold[k]; return true; }
  if (own(hold, k) || !order || !order.includes(k)) { hold[k] = v; return true; }
  // insert at the schema position, keeping every other key where it is
  const at = order.indexOf(k);
  const keys = Object.keys(hold);
  let pos = keys.length;
  const before = order.slice(0, at).reverse().find((x) => own(hold, x));
  if (before !== undefined) pos = keys.indexOf(before) + 1;
  else { const after = order.slice(at + 1).find((x) => own(hold, x)); if (after !== undefined) pos = keys.indexOf(after); }
  const entries = Object.entries(hold);
  entries.splice(pos, 0, [k, v]);
  for (const x of keys) delete hold[x];
  for (const [x, y] of entries) hold[x] = y;
  return true;
}
