// Site editing state. Per src/content/site/<file>.json: the repo copy (sha, text, data) and
// the working copy (`cur`), plus item identities (`ids`: for every array in cur, one id per
// item: the item's pointer in the repo copy, or "+…" for an item added here) so the review can
// tell added / removed / moved items apart from edited ones. Every operation is undoable
// (whole-file snapshots; files are a few KB). The working copy autosaves on this device and
// is restored on top of newer repo copies with a three-way merge when that's safe; otherwise
// the person is asked (never silently dropped). Publishing is sha-checked the same way.
import { loadJson, saveFiles, FileConflictError, type SavedFile } from '../github';
import { getPtr, putPtr, parseKey, serialize, join, split, tokens, isIndex, under, clone, equal, keyOf, type Key } from './pointer';
import { orderAt, fieldAt, validateFile, type Field } from './fields';

export const SITE_DIR = 'src/content/site';
const LOCAL = 'bx-write:site:';

/** Whitespace as typed in a contenteditable (nbsp, runs, edges) never counts as a change. */
export const norm = (s: string) => s.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const same = (a: unknown, b: unknown) => (typeof a === 'string' && typeof b === 'string' ? norm(a) === norm(b) : equal(a, b));

export type Ids = Record<string, string[]>;
export type FileState = { name: string; path: string; sha: string; text: string; base: unknown; cur: unknown; ids: Ids };
type Snap = { cur: string; ids: string; epoch: number };
type UndoEntry = { label: string; at: number; co?: string; files: Record<string, { before: Snap; after: Snap }>; keys: Key[] };
type LocalV1 = { sha: string; edits: Record<string, string>; orig: Record<string, string>; savedAt: number };
type LocalV2 = { v: 2; sha: string; base: unknown; cur: unknown; ids: Ids; savedAt: number };

/** A field whose edit here and on GitHub differ (values shown to the person). */
export type Conflict = { file: string; ptr: string; mine: unknown; theirs: unknown };
/** A restore that needs a decision: field conflicts, or structural edits over a changed repo copy. */
export type Problem =
  | { kind: 'fields'; file: string; conflicts: Conflict[]; apply(keepMine: boolean): void }
  | { kind: 'structure'; file: string; theirs: unknown; mine: unknown; apply(keepMine: boolean): void };

export type Change =
  | { kind: 'field'; file: string; key: Key; ptr: string; basePtr: string; field: Field | null; old: unknown; now: unknown }
  | { kind: 'added'; file: string; key: Key; ptr: string; listPtr: string; index: number; value: unknown }
  | { kind: 'removed'; file: string; key: Key; listPtr: string; basePtr: string; baseIndex: number; value: unknown }
  | { kind: 'moved'; file: string; key: Key; ptr: string; listPtr: string; index: number; from: number; value: unknown };
export type ChangeEvent = { keys: Key[] | null; structural: boolean; files: string[]; source?: string };

// ---------- item identities ----------
let seq = 0;
export const freshId = () => `+${(++seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const isBaseId = (id: string | undefined): id is string => !!id && id.startsWith('/');
export function identity(data: unknown, ptr = '', out: Ids = {}): Ids {
  if (Array.isArray(data)) { out[ptr] = data.map((_, i) => join(ptr, i)); data.forEach((v, i) => identity(v, join(ptr, i), out)); }
  else if (data && typeof data === 'object') for (const [k, v] of Object.entries(data)) identity(v, join(ptr, k), out);
  return out;
}
/** ids for every array inside value (at curPtr); restored repo items keep their repo ids. */
function seed(ids: Ids, value: unknown, curPtr: string, basePtr: string | null) {
  if (Array.isArray(value)) {
    ids[curPtr] = value.map((_, i) => (basePtr !== null ? join(basePtr, i) : freshId()));
    value.forEach((v, i) => seed(ids, v, join(curPtr, i), basePtr !== null ? join(basePtr, i) : null));
  } else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) seed(ids, v, join(curPtr, k), basePtr !== null ? join(basePtr, k) : null);
}
const dropUnder = (ids: Ids, p: string) => { for (const k of Object.keys(ids)) if (under(k, p)) delete ids[k]; };
/** Re-key ids of arrays inside items of list L after its items moved: f(oldIndex) → newIndex (null = gone). */
function remap(ids: Ids, L: string, f: (i: number) => number | null): Ids {
  const pre = L + '/';
  const out: Ids = {};
  for (const [k, v] of Object.entries(ids)) {
    if (!k.startsWith(pre)) { out[k] = v; continue; }
    const rest = k.slice(pre.length), cut = rest.indexOf('/');
    const tok = cut < 0 ? rest : rest.slice(0, cut);
    if (!isIndex(tok)) { out[k] = v; continue; }
    const n = f(+tok);
    if (n === null) continue;
    out[pre + n + (cut < 0 ? '' : rest.slice(cut))] = v;
  }
  return out;
}
const containsArray = (v: unknown): boolean => Array.isArray(v) || (!!v && typeof v === 'object' && Object.values(v).some(containsArray));
function idsFit(ids: Ids | undefined, data: unknown): boolean {
  if (!ids || typeof ids !== 'object') return false;
  const want = identity(data);
  const ks = Object.keys(want);
  return ks.length === Object.keys(ids).length && ks.every((k) => Array.isArray(ids[k]) && ids[k].length === want[k].length);
}
function leaves(v: unknown, p = '', out = new Map<string, unknown>()) {
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) leaves(x, join(p, k), out);
  else out.set(p, v);
  return out;
}
function similarity(a: unknown, b: unknown): number {
  if (typeof a === 'string' && typeof b === 'string') {
    const wa = new Set(a.toLowerCase().split(/\W+/).filter(Boolean)), wb = b.toLowerCase().split(/\W+/).filter(Boolean);
    return wb.length || wa.size ? wb.filter((w) => wa.has(w)).length / Math.max(wa.size, wb.length) : 1;
  }
  const la = leaves(a), lb = leaves(b);
  let n = 0;
  for (const [k, v] of lb) if (la.has(k) && same(la.get(k), v)) n++;
  return n / Math.max(la.size, lb.size, 1);
}
/** Best-guess identities for cur against base (equal items first, then the most similar). */
export function matchIds(base: unknown, cur: unknown, bp = '', cp = '', ids: Ids = {}): Ids {
  if (Array.isArray(cur)) {
    const b = Array.isArray(base) ? base : [];
    const used = new Set<number>();
    const pick: (number | null)[] = cur.map(() => null);
    cur.forEach((c, i) => { const j = b.findIndex((x, j) => !used.has(j) && equal(x, c)); if (j >= 0) { used.add(j); pick[i] = j; } });
    cur.forEach((c, i) => {
      if (pick[i] !== null) return;
      let best = -1, score = 0.34;
      b.forEach((x, j) => { if (used.has(j)) return; const s = similarity(x, c) - Math.abs(i - j) * 0.01; if (s > score) { score = s; best = j; } });
      if (best >= 0) { used.add(best); pick[i] = best; }
    });
    ids[cp] = pick.map((j) => (j === null ? freshId() : join(bp, j)));
    cur.forEach((c, i) => { const j = pick[i]; if (j === null) seed(ids, c, join(cp, i), null); else matchIds(b[j], c, join(bp, j), join(cp, i), ids); });
  } else if (cur && typeof cur === 'object') {
    for (const [k, v] of Object.entries(cur)) matchIds(base && typeof base === 'object' ? (base as any)[k] : undefined, v, join(bp, k), join(cp, k), ids);
  }
  return ids;
}

// ---------- three-way merge ----------
/** Pointers where a and b differ: leaves, or the array/object itself when its shape differs. */
function diffPaths(a: unknown, b: unknown, p = '', out: { p: string; shape: boolean }[] = []) {
  if (same(a, b)) return out;
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) a.forEach((x, i) => diffPaths(x, b[i], join(p, i), out));
  else if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diffPaths((a as any)[k], (b as any)[k], join(p, k), out);
  } else out.push({ p, shape: Array.isArray(a) || Array.isArray(b) });
  return out;
}
const structuralIds = (data: unknown, ids: Ids) => { const want = identity(data); return Object.keys(want).some((k) => !equal(want[k], ids[k])) || Object.keys(ids).length !== Object.keys(want).length; };
type Merge = { ok: true; cur: unknown; ids: Ids } | { ok: false; structural: boolean; conflicts: Conflict[]; partial: (keepMine: boolean) => { cur: unknown; ids: Ids } };
/** Put my edits (old → mine) on top of a newer repo copy (old → fresh). */
export function threeWay(file: string, old: unknown, mine: unknown, mineIds: Ids, fresh: unknown): Merge {
  if (equal(old, fresh)) return { ok: true, cur: clone(mine), ids: mineIds };
  if (!structuralIds(mine, mineIds)) {
    // edits only changed values: v1's per-field rule
    const out = clone(fresh);
    const conflicts: Conflict[] = [];
    const remote = diffPaths(old, fresh);
    for (const { p } of diffPaths(old, mine)) {
      const v = getPtr(mine, p);
      const touched = remote.some((r) => under(p, r.p) || under(r.p, p));
      if (!touched) { if (!putPtr(out, p, clone(v), orderAt(file, split(p)?.parent ?? ''))) conflicts.push({ file, ptr: p, mine: v, theirs: undefined }); continue; }
      const theirs = getPtr(fresh, p);
      if (!same(theirs, v)) conflicts.push({ file, ptr: p, mine: v, theirs });
    }
    if (!conflicts.length) return { ok: true, cur: out, ids: matchIds(fresh, out) };
    return {
      ok: false, structural: false, conflicts,
      partial: (keepMine) => { const o = clone(out); if (keepMine) for (const c of conflicts) putPtr(o, c.ptr, clone(c.mine), orderAt(file, split(c.ptr)?.parent ?? '')); return { cur: o, ids: matchIds(fresh, o) }; },
    };
  }
  // structural edits here: merge only when GitHub's copy changed values, not shape, and not what I changed
  const remote = diffPaths(old, fresh);
  const reverse = new Map<string, string>();
  for (const [L, list] of Object.entries(mineIds)) list.forEach((id, i) => { if (isBaseId(id)) reverse.set(id, join(L, i)); });
  const toCur = (p: string): string | null => {
    const t = tokens(p);
    for (let n = t.length; n > 0; n--) {
      if (!isIndex(t[n - 1])) continue;
      const pre = join('', ...t.slice(0, n));
      const c = reverse.get(pre);
      return c === undefined ? null : join(c, ...t.slice(n));
    }
    return p;
  };
  const out = clone(mine);
  let safe = !remote.some((r) => r.shape);
  const conflicts: Conflict[] = [];
  if (safe) for (const { p } of remote) {
    const cp = toCur(p);
    const theirs = getPtr(fresh, p);
    if (cp === null) { safe = false; conflicts.push({ file, ptr: p, mine: undefined, theirs }); continue; }
    const v = getPtr(mine, cp);
    if (same(v, getPtr(old, p))) putPtr(out, cp, clone(theirs), orderAt(file, split(cp)?.parent ?? ''));
    else if (!same(v, theirs)) { safe = false; conflicts.push({ file, ptr: cp, mine: v, theirs }); }
  }
  if (safe) return { ok: true, cur: out, ids: mineIds };
  return { ok: false, structural: true, conflicts, partial: (keepMine) => (keepMine ? { cur: clone(mine), ids: matchIds(fresh, mine) } : { cur: clone(fresh), ids: identity(fresh) }) };
}

// ---------- local storage ----------
const ls = () => { try { return localStorage; } catch { return null; } };
function readLocal(name: string): LocalV1 | LocalV2 | null {
  try {
    const e = JSON.parse(ls()?.getItem(LOCAL + name) || 'null');
    if (e && e.v === 2 && typeof e.sha === 'string' && 'cur' in e) return e as LocalV2;
    return e && typeof e.sha === 'string' && e.edits && typeof e.edits === 'object' ? (e as LocalV1) : null;
  } catch { return null; }
}
export function localFiles(): string[] {
  const s = ls(); const out: string[] = [];
  if (!s) return out;
  try { for (let i = 0; i < s.length; i++) { const k = s.key(i); if (k?.startsWith(LOCAL)) out.push(k.slice(LOCAL.length)); } } catch {}
  return out;
}

export function createSiteState(onChange: (e: ChangeEvent) => void) {
  const files = new Map<string, FileState>();
  const failed = new Map<string, string>();
  const loading = new Map<string, Promise<Problem[]>>();
  const held = new Set<string>(); // files whose local copy waits for a decision (not written over)
  /** Items created by Duplicate: new id → the id they copy (the page clones that element). */
  const cloneOf = new Map<string, string>();
  let localOk = true, localAt = 0;
  const saveTimers = new Map<string, number>();
  const undos: UndoEntry[] = [], redos: UndoEntry[] = [];
  let group: UndoEntry | null = null;
  let sess = 0;
  let epoch = 0; // bumps on publish: snapshots from before then get their ids re-matched

  const fileOfKey = (k: Key) => { const p = parseKey(k); const f = p && files.get(p.file); return p && f ? { f, ptr: p.ptr } : null; };
  const get = (k: Key): unknown => { const x = fileOfKey(k); return x ? getPtr(x.f.cur, x.ptr) : undefined; };
  const value = (k: Key): string | undefined => { const v = get(k); return typeof v === 'string' ? v : undefined; };

  /** The repo pointer of the value at cur ptr; null inside an item added here. */
  function basePtr(f: FileState, ptr: string): string | null {
    let cp = '', bp = '';
    let v: unknown = f.cur;
    for (const t of tokens(ptr)) {
      if (Array.isArray(v) && isIndex(t)) {
        const id = f.ids[cp]?.[+t];
        if (!isBaseId(id)) return null;
        bp = id;
      } else bp = join(bp, t);
      cp = join(cp, t);
      v = v && typeof v === 'object' ? (v as any)[t] : undefined;
    }
    return bp;
  }
  function original(k: Key): unknown {
    const x = fileOfKey(k);
    if (!x) return undefined;
    const bp = basePtr(x.f, x.ptr);
    return bp === null ? undefined : getPtr(x.f.base, bp);
  }
  function changed(k: Key): boolean {
    const x = fileOfKey(k);
    if (!x) return false;
    const bp = basePtr(x.f, x.ptr);
    if (bp === null) return true;
    return !same(getPtr(x.f.base, bp), getPtr(x.f.cur, x.ptr));
  }

  // ---------- autosave ----------
  function writeLocal(f: FileState) {
    if (held.has(f.name)) return;
    const s = ls();
    if (!s) { localOk = false; return; }
    try {
      if (equal(f.cur, f.base)) s.removeItem(LOCAL + f.name);
      else s.setItem(LOCAL + f.name, JSON.stringify({ v: 2, sha: f.sha, base: f.base, cur: f.cur, ids: f.ids, savedAt: Date.now() } satisfies LocalV2));
      localOk = true; localAt = Date.now();
    } catch { localOk = false; }
  }
  function saveSoon(f: FileState) {
    clearTimeout(saveTimers.get(f.name));
    saveTimers.set(f.name, window.setTimeout(() => { saveTimers.delete(f.name); writeLocal(f); onChange({ keys: [], structural: false, files: [], source: 'save' }); }, 300));
  }
  function flush() { for (const [name, t] of saveTimers) { clearTimeout(t); const f = files.get(name); if (f) writeLocal(f); } saveTimers.clear(); }

  // ---------- loading ----------
  function restore(f: FileState, e: LocalV1 | LocalV2): Problem | null {
    if (!('v' in e)) {
      // a v1 entry: per-field string edits on top of the repo copy it was made on
      const out: Conflict[] = [];
      const cur = clone(f.base);
      for (const [p, mine] of Object.entries(e.edits)) {
        const now = getPtr(f.base, p);
        if (typeof now !== 'string' || typeof mine !== 'string' || norm(now) === norm(mine)) continue;
        if (e.sha === f.sha || now === e.orig?.[p]) putPtr(cur, p, mine);
        else out.push({ file: f.name, ptr: p, mine, theirs: now });
      }
      f.cur = cur; f.ids = identity(cur);
      if (!out.length) return null;
      held.add(f.name);
      return { kind: 'fields', file: f.name, conflicts: out, apply: (keep) => { held.delete(f.name); if (keep) for (const c of out) putPtr(f.cur, c.ptr, c.mine); writeLocal(f); emitAll([f.name]); } };
    }
    if (e.sha === f.sha || equal(e.base, f.base)) {
      f.cur = e.cur; f.ids = idsFit(e.ids, e.cur) ? e.ids : matchIds(f.base, e.cur);
      return null;
    }
    const ids = idsFit(e.ids, e.cur) ? e.ids : matchIds(e.base, e.cur);
    const m = threeWay(f.name, e.base, e.cur, ids, f.base);
    if (m.ok) { f.cur = m.cur; f.ids = m.ids; return null; }
    held.add(f.name); // keep the saved copy untouched until the person decides
    const apply = (keep: boolean) => { held.delete(f.name); const r = m.partial(keep); f.cur = r.cur; f.ids = r.ids; writeLocal(f); emitAll([f.name]); };
    return m.structural ? { kind: 'structure', file: f.name, theirs: f.base, mine: e.cur, apply } : { kind: 'fields', file: f.name, conflicts: m.conflicts, apply };
  }
  async function load1(name: string): Promise<Problem[]> {
    const path = `${SITE_DIR}/${name}.json`;
    try {
      const r = await loadJson(path);
      if (!r) { failed.set(name, `${name}.json isn’t in the repo yet.`); return []; }
      if (r.data === null || typeof r.data !== 'object') { failed.set(name, `${name}.json isn’t a JSON object.`); return []; }
      failed.delete(name);
      const f: FileState = { name, path, sha: r.sha, text: r.text, base: r.data, cur: clone(r.data), ids: identity(r.data) };
      files.set(name, f);
      const e = readLocal(name);
      const p = e ? restore(f, e) : null;
      if (e && !p) writeLocal(f);
      return p ? [p] : [];
    } catch (e) {
      failed.set(name, (e as Error).message || `Couldn’t load ${name}.json`);
      return [];
    }
  }
  async function ensure(names: string[]): Promise<Problem[]> {
    const todo = [...new Set(names)].filter((n) => !files.has(n));
    const ps = todo.map((n) => { let p = loading.get(n); if (!p) { p = load1(n).finally(() => loading.delete(n)); loading.set(n, p); } return p; });
    const res = (await Promise.all(ps)).flat();
    if (todo.length) emitAll(todo);
    return res;
  }
  const emitAll = (fs: string[], source?: string) => onChange({ keys: null, structural: true, files: fs, source });

  // ---------- operations (all undoable) ----------
  const snap = (f: FileState): Snap => ({ cur: JSON.stringify(f.cur), ids: JSON.stringify(f.ids), epoch });
  function mutate(name: string, label: string, fn: (f: FileState) => boolean | void, o: { co?: string; keys?: Key[]; structural?: boolean; source?: string } = {}): boolean {
    const f = files.get(name);
    if (!f || held.has(name)) return false;
    const before = snap(f);
    if (fn(f) === false) return false;
    const after = snap(f);
    if (before.cur === after.cur && before.ids === after.ids) return false;
    const now = Date.now();
    if (group) {
      const g = group.files[name];
      if (g) g.after = after; else group.files[name] = { before, after };
      group.keys.push(...(o.keys || []));
    } else {
      const top = undos[undos.length - 1];
      if (o.co && top && top.co === o.co && now - top.at < 2500 && top.files[name] && Object.keys(top.files).length === 1) { top.files[name].after = after; top.at = now; }
      else {
        undos.push({ label, at: now, co: o.co, files: { [name]: { before, after } }, keys: o.keys || [] });
        if (undos.length > 300) undos.shift();
      }
      redos.length = 0;
    }
    saveSoon(f);
    onChange({ keys: o.structural ? null : o.keys || null, structural: !!o.structural, files: [name], source: o.source });
    return true;
  }
  /** Several operations as one undo step. */
  function batch<T>(label: string, fn: () => T): T {
    if (group) return fn();
    group = { label, at: Date.now(), files: {}, keys: [] };
    try { return fn(); }
    finally {
      const g = group; group = null;
      if (Object.keys(g.files).length) { undos.push(g); redos.length = 0; }
    }
  }
  /** Set any value (undefined removes an optional key). opts.typing: a run of typing is one undo step. */
  function set(k: Key, v: unknown, o: { typing?: boolean; label?: string; source?: string; basePtr?: string | null } = {}): boolean {
    const x = fileOfKey(k);
    if (!x) return false;
    const prev = getPtr(x.f.cur, x.ptr);
    if (equal(prev, v)) return false;
    if (prev === undefined && split(x.ptr) && getPtr(x.f.cur, split(x.ptr)!.parent) === undefined) return false;
    const structural = containsArray(prev) || containsArray(v);
    return mutate(x.f.name, o.label || 'Edit', (f) => {
      if (!putPtr(f.cur, x.ptr, clone(v), orderAt(f.name, split(x.ptr)!.parent))) return false;
      if (structural) { dropUnder(f.ids, x.ptr); if (v !== undefined) seed(f.ids, v, x.ptr, o.basePtr ?? null); }
    }, { co: o.typing ? `${k}#${sess}` : undefined, keys: [k], structural, source: o.source });
  }
  function insert(listKey: Key, index: number, v: unknown, o: { id?: string; cloneOf?: string; label?: string } = {}): Key | null {
    const x = fileOfKey(listKey);
    const arr = x && getPtr(x.f.cur, x.ptr);
    if (!x || !Array.isArray(arr)) return null;
    const at = Math.max(0, Math.min(arr.length, index));
    const id = o.id ?? freshId();
    const ok = mutate(x.f.name, o.label || 'Add', (f) => {
      (getPtr(f.cur, x.ptr) as unknown[]).splice(at, 0, clone(v));
      f.ids = remap(f.ids, x.ptr, (i) => (i >= at ? i + 1 : i));
      (f.ids[x.ptr] ||= []).splice(at, 0, id);
      seed(f.ids, v, join(x.ptr, at), isBaseId(id) ? id : null);
    }, { structural: true, keys: [listKey] });
    if (!ok) return null;
    if (o.cloneOf) cloneOf.set(id, o.cloneOf);
    return keyOf(x.f.name, join(x.ptr, at));
  }
  function remove(listKey: Key, index: number, label = 'Delete'): unknown {
    const x = fileOfKey(listKey);
    const arr = x && getPtr(x.f.cur, x.ptr);
    if (!x || !Array.isArray(arr) || index < 0 || index >= arr.length) return undefined;
    const v = clone(arr[index]);
    mutate(x.f.name, label, (f) => {
      (getPtr(f.cur, x.ptr) as unknown[]).splice(index, 1);
      f.ids[x.ptr]?.splice(index, 1);
      dropUnder(f.ids, join(x.ptr, index));
      f.ids = remap(f.ids, x.ptr, (i) => (i > index ? i - 1 : i));
    }, { structural: true, keys: [listKey] });
    return v;
  }
  function move(listKey: Key, from: number, to: number, label = 'Move'): boolean {
    const x = fileOfKey(listKey);
    const arr = x && getPtr(x.f.cur, x.ptr);
    if (!x || !Array.isArray(arr) || from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return false;
    const order = arr.map((_, i) => i);
    const [o] = order.splice(from, 1); order.splice(to, 0, o);
    const pos = new Map(order.map((old, n) => [old, n]));
    return mutate(x.f.name, label, (f) => {
      const a = getPtr(f.cur, x.ptr) as unknown[];
      const [item] = a.splice(from, 1); a.splice(to, 0, item);
      const ids = f.ids[x.ptr];
      if (ids) { const [id] = ids.splice(from, 1); ids.splice(to, 0, id); }
      f.ids = remap(f.ids, x.ptr, (i) => pos.get(i) ?? i);
    }, { structural: true, keys: [listKey] });
  }
  function duplicate(itemKey: Key): Key | null {
    const x = fileOfKey(itemKey);
    const s = x && split(x.ptr);
    if (!x || !s || !isIndex(s.last)) return null;
    const v = getPtr(x.f.cur, x.ptr);
    return insert(keyOf(x.f.name, s.parent), +s.last + 1, v, { cloneOf: x.f.ids[s.parent]?.[+s.last], label: 'Duplicate' });
  }
  function idOf(itemKey: Key): string | undefined {
    const x = fileOfKey(itemKey); const s = x && split(x.ptr);
    return x && s ? x.f.ids[s.parent]?.[+s.last] : undefined;
  }
  function keyOfId(file: string, id: string): Key | null {
    const f = files.get(file);
    if (!f) return null;
    for (const [L, list] of Object.entries(f.ids)) { const i = list.indexOf(id); if (i >= 0) return keyOf(file, join(L, i)); }
    return null;
  }
  const idsOf = (listKey: Key): string[] | undefined => { const x = fileOfKey(listKey); return x ? x.f.ids[x.ptr] : undefined; };

  function restoreSnap(f: FileState, s: Snap) {
    f.cur = JSON.parse(s.cur);
    f.ids = JSON.parse(s.ids);
    if (s.epoch !== epoch) f.ids = matchIds(f.base, f.cur);
    saveSoon(f);
  }
  function undo(): UndoEntry | null {
    sess++;
    const e = undos.pop();
    if (!e) return null;
    for (const [n, s] of Object.entries(e.files)) { const f = files.get(n); if (f && !held.has(n)) restoreSnap(f, s.before); }
    redos.push(e);
    emitAll(Object.keys(e.files), 'undo');
    return e;
  }
  function redo(): UndoEntry | null {
    sess++;
    const e = redos.pop();
    if (!e) return null;
    for (const [n, s] of Object.entries(e.files)) { const f = files.get(n); if (f && !held.has(n)) restoreSnap(f, s.after); }
    undos.push(e);
    emitAll(Object.keys(e.files), 'redo');
    return e;
  }
  function beginEdit(_k: Key) { sess++; }
  function endEdit() { sess++; }

  // ---------- changes ----------
  function diffFile(f: FileState): Change[] {
    const out: Change[] = [];
    if (equal(f.base, f.cur)) return out;
    const walk = (fld: Field | null, b: unknown, c: unknown, bp: string, cp: string) => {
      if (same(b, c)) return;
      if (Array.isArray(b) && Array.isArray(c)) {
        const ids = f.ids[cp] || [];
        const at: (number | null)[] = c.map((_, i) => {
          const id = ids[i];
          if (!isBaseId(id)) return null;
          const s = split(id);
          return s && s.parent === bp && isIndex(s.last) && +s.last < b.length ? +s.last : null;
        });
        const seen = new Set<number>();
        at.forEach((j, i) => { if (j !== null && seen.has(j)) at[i] = null; else if (j !== null) seen.add(j); });
        // longest increasing run of repo positions: everything else matched has moved
        const idx = at.map((j, i) => [j, i] as const).filter(([j]) => j !== null) as [number, number][];
        const keep = new Set<number>();
        { const tails: number[] = [], prev: number[] = new Array(idx.length).fill(-1), tailAt: number[] = [];
          idx.forEach(([j], n) => {
            let lo = 0, hi = tails.length;
            while (lo < hi) { const m = (lo + hi) >> 1; if (tails[m] < j) lo = m + 1; else hi = m; }
            tails[lo] = j; tailAt[lo] = n; prev[n] = lo ? tailAt[lo - 1] : -1;
          });
          for (let n = tailAt[tails.length - 1] ?? -1; n >= 0; n = prev[n]) keep.add(idx[n][1]);
        }
        const item = fld?.type === 'list' ? fld.item : null;
        c.forEach((v, i) => {
          const j = at[i];
          const ptr = join(cp, i), key = keyOf(f.name, ptr);
          if (j === null) { out.push({ kind: 'added', file: f.name, key, ptr, listPtr: cp, index: i, value: v }); return; }
          if (!keep.has(i)) out.push({ kind: 'moved', file: f.name, key, ptr, listPtr: cp, index: i, from: j, value: v });
          walk(item, b[j], v, join(bp, j), ptr);
        });
        b.forEach((v, j) => { if (!seen.has(j)) out.push({ kind: 'removed', file: f.name, key: keyOf(f.name, join(bp, j)), listPtr: cp, basePtr: join(bp, j), baseIndex: j, value: v }); });
        return;
      }
      const isObj = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v);
      if (isObj(b) && isObj(c)) {
        const order = fld?.type === 'object' ? Object.keys(fld.fields) : [];
        const ks = [...new Set([...order.filter((k) => k in (b as object) || k in (c as object)), ...Object.keys(b as object), ...Object.keys(c as object)])];
        for (const k of ks) {
          const sub = fld?.type === 'object' ? fld.fields[k] ?? null : null;
          const bv = (b as any)[k], cv = (c as any)[k];
          if (bv === undefined || cv === undefined) { if (bv !== cv) out.push({ kind: 'field', file: f.name, key: keyOf(f.name, join(cp, k)), ptr: join(cp, k), basePtr: join(bp, k), field: sub, old: bv, now: cv }); }
          else walk(sub, bv, cv, join(bp, k), join(cp, k));
        }
        return;
      }
      out.push({ kind: 'field', file: f.name, key: keyOf(f.name, cp), ptr: cp, basePtr: bp, field: fld, old: b, now: c });
    };
    walk(fieldAt(f.name, ''), f.base, f.cur, '', '');
    return out;
  }
  const changes = () => [...files.values()].flatMap(diffFile);
  /** Undo one change from the review (itself undoable). */
  function revert(c: Change) {
    const f = files.get(c.file);
    if (!f) return;
    if (c.kind === 'field') { set(c.key, clone(c.old), { label: 'Revert', basePtr: c.basePtr }); return; }
    const L = keyOf(c.file, c.listPtr);
    if (c.kind === 'added') { remove(L, c.index, 'Revert'); return; }
    const ids = f.ids[c.listPtr] || [];
    const baseIdx = (id: string | undefined) => { const s = isBaseId(id) ? split(id) : null; return s && isIndex(s.last) ? +s.last : null; };
    if (c.kind === 'removed') {
      let pos = 0;
      ids.forEach((id, i) => { const j = baseIdx(id); if (j !== null && j < c.baseIndex) pos = i + 1; });
      insert(L, pos, c.value, { id: c.basePtr, label: 'Restore' });
      return;
    }
    // moved: back after the nearest repo-earlier sibling
    const rest = ids.filter((_, i) => i !== c.index);
    let pos = 0;
    rest.forEach((id, i) => { const j = baseIdx(id); if (j !== null && j < c.from) pos = i + 1; });
    move(L, c.index, pos, 'Move back');
  }
  function discardFile(name: string) {
    const f = files.get(name);
    if (!f) return;
    mutate(name, 'Discard', (x) => { x.cur = clone(x.base); x.ids = identity(x.base); }, { structural: true });
  }
  function discardAll() {
    batch('Discard all', () => { for (const f of files.values()) discardFile(f.name); });
    for (const n of localFiles()) if (!files.has(n)) try { ls()?.removeItem(LOCAL + n); } catch {}
  }
  const retry = (names: string[]) => names.forEach((n) => failed.delete(n));
  const dirty = (f: FileState) => !equal(f.base, f.cur);

  /** Validation issues for the files with changes (they'd block publishing). */
  function issues(): { file: string; key: Key; ptr: string; message: string }[] {
    const out: { file: string; key: Key; ptr: string; message: string }[] = [];
    for (const f of files.values()) if (dirty(f)) for (const i of validateFile(f.name, f.cur)) out.push({ file: f.name, key: keyOf(f.name, i.path), ptr: i.path, message: i.message });
    return out;
  }

  // ---------- publishing ----------
  class PublishConflict extends Error {
    file: string; structural: boolean; conflicts: Conflict[]; fresh: { sha: string; text: string; data: unknown } | null;
    resolve: (keepMine: boolean) => void;
    constructor(file: string, m: Extract<Merge, { ok: false }> | null, fresh: PublishConflict['fresh']) {
      super(`${file}.json changed on GitHub since you opened it.`); this.name = 'PublishConflict';
      this.file = file; this.fresh = fresh; this.structural = !!m?.structural; this.conflicts = m?.conflicts || [];
      this.resolve = (keep) => {
        const f = files.get(file);
        if (!f || !fresh || !m) return;
        const r = m.partial(keep);
        f.sha = fresh.sha; f.text = fresh.text; f.base = fresh.data; f.cur = r.cur; f.ids = r.ids;
        undos.length = 0; redos.length = 0; // their structure changed under every snapshot
        writeLocal(f); emitAll([file]);
      };
    }
  }
  /** What gets written: changed text tidied (whitespace), everything else exactly as edited. */
  function output(f: FileState): unknown {
    const out = clone(f.cur);
    const walk = (v: unknown, p: string) => {
      if (typeof v === 'string') {
        const t = fieldAt(f.name, p)?.type;
        // untouched repo text is written back byte for byte, even if it has odd spacing
        if ((t === 'plain' || t === 'inline' || t === 'url') && v !== norm(v) && original(keyOf(f.name, p)) !== v) putPtr(out, p, norm(v));
      } else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, join(p, k));
    };
    walk(f.cur, '');
    return out;
  }
  async function publish(): Promise<{ commit: SavedFile['commit']; files: string[] } | null> {
    flush();
    sess++;
    const todo = [...files.values()].filter(dirty);
    let last: SavedFile['commit'] | null = null;
    const done: string[] = [];
    for (const f of todo) {
      const fresh = await loadJson(f.path);
      if (!fresh) throw new PublishConflict(f.name, null, null);
      if (fresh.sha !== f.sha) {
        if (equal(fresh.data, f.base)) { f.sha = fresh.sha; f.text = fresh.text; }
        else {
          const m = threeWay(f.name, f.base, f.cur, f.ids, fresh.data);
          if (!m.ok) throw new PublishConflict(f.name, m, fresh);
          f.sha = fresh.sha; f.text = fresh.text; f.base = fresh.data; f.cur = m.cur; f.ids = m.ids;
          emitAll([f.name]);
        }
      }
      if (!dirty(f)) continue;
      const data = output(f);
      const sent = JSON.stringify(f.cur);
      const content = serialize(data, f.text);
      const n = diffFile(f).length;
      try {
        await saveFiles([{ path: f.path, content, expectSha: f.sha }], `Site: edit ${f.name} (${n} ${n === 1 ? 'change' : 'changes'})`, {
          onSaved: (r) => {
            f.sha = r.sha; f.text = content; f.base = clone(data);
            if (JSON.stringify(f.cur) === sent) f.cur = clone(data); // edits made during the save stay
            f.ids = matchIds(f.base, f.cur);
            epoch++;
            writeLocal(f);
            last = r.commit; done.push(f.name);
          },
        });
      } catch (e) {
        if (e instanceof FileConflictError) {
          const again = await loadJson(f.path);
          const m = again ? threeWay(f.name, f.base, f.cur, f.ids, again.data) : null;
          throw new PublishConflict(f.name, m && !m.ok ? m : null, again);
        }
        throw e;
      }
    }
    emitAll(done);
    return last ? { commit: last, files: done } : null;
  }

  return {
    files, failed, ensure, retry, get, value, original, changed, set, insert, remove, move, duplicate, batch,
    beginEdit, endEdit, undo, redo, changes, revert, discardFile, discardAll, publish, issues, flush,
    idOf, keyOfId, idsOf, cloneOf, PublishConflict,
    loaded: (file: string) => files.has(file),
    held: (file: string) => held.has(file),
    get count() { return changes().length; },
    get canUndo() { return undos.length > 0; },
    get canRedo() { return redos.length > 0; },
    get undoLabel() { return undos[undos.length - 1]?.label; },
    get redoLabel() { return redos[redos.length - 1]?.label; },
    get localOk() { return localOk; },
    get localAt() { return localAt; },
    orphaned: () => localFiles().filter((n) => !files.has(n)),
  };
}
export type SiteState = ReturnType<typeof createSiteState>;
