// Site text editing: the repo copy of each src/content/site/<file>.json (with its sha),
// the edits made here (per file, keyed by JSON pointer), local autosave of those edits,
// an undo stack, and publishing (sha-checked, rebased onto newer repo copies when the
// newer copy didn't touch the same fields).
import { loadJson, saveFiles, FileConflictError, type SavedFile } from '../github';
import { getPtr, setPtr, parseKey, serialize, type Key } from './pointer';

export const SITE_DIR = 'src/content/site';
const LOCAL = 'bx-write:site:';

export type FileState = {
  name: string;
  path: string;
  sha: string;
  text: string;
  data: unknown;
  edits: Map<string, string>; // pointer → new value
};
export type Change = { key: Key; file: string; ptr: string; old: string; now: string };
type LocalEntry = { sha: string; edits: Record<string, string>; orig: Record<string, string>; savedAt: number };

/** Whitespace as typed in a contenteditable (nbsp, runs, edges) never counts as a change. */
export const norm = (s: string) => s.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

const ls = () => { try { return localStorage; } catch { return null; } };
function readLocal(name: string): LocalEntry | null {
  try {
    const e = JSON.parse(ls()?.getItem(LOCAL + name) || 'null');
    return e && typeof e.sha === 'string' && e.edits && typeof e.edits === 'object' ? e : null;
  } catch { return null; }
}
export function localFiles(): string[] {
  const s = ls(); const out: string[] = [];
  if (!s) return out;
  try { for (let i = 0; i < s.length; i++) { const k = s.key(i); if (k?.startsWith(LOCAL)) out.push(k.slice(LOCAL.length)); } } catch {}
  return out;
}

export type Conflict = { file: string; ptr: string; mine: string; theirs: string };

/** onChange(keys): those fields changed; [] = anything may have (repo copies moved); null = only save status. */
export function createSiteState(onChange: (keys: Key[] | null) => void) {
  const files = new Map<string, FileState>();
  const failed = new Map<string, string>(); // file → error message
  const loading = new Map<string, Promise<Conflict[]>>();
  let localOk = true;
  let localAt = 0;
  const saveTimers = new Map<string, number>();
  type Undo = { key: Key; prev: string };
  const undos: Undo[] = [];
  let session: (Undo & { pushed: boolean }) | null = null; // the field being typed in

  const fileOf = (k: Key) => { const p = parseKey(k); return p ? files.get(p.file) ?? null : null; };
  function original(k: Key): string | undefined {
    const p = parseKey(k); const f = p && files.get(p.file);
    if (!p || !f) return undefined;
    const v = getPtr(f.data, p.ptr);
    return typeof v === 'string' ? v : undefined;
  }
  function value(k: Key): string | undefined {
    const p = parseKey(k); const f = p && files.get(p.file);
    if (!p || !f) return undefined;
    return f.edits.get(p.ptr) ?? original(k);
  }

  // ---------- local autosave ----------
  function writeLocal(f: FileState) {
    const s = ls();
    if (!s) { localOk = false; return; }
    try {
      if (!f.edits.size) s.removeItem(LOCAL + f.name);
      else {
        const orig: Record<string, string> = {};
        for (const p of f.edits.keys()) orig[p] = (getPtr(f.data, p) as string) ?? '';
        s.setItem(LOCAL + f.name, JSON.stringify({ sha: f.sha, edits: Object.fromEntries(f.edits), orig, savedAt: Date.now() } satisfies LocalEntry));
      }
      localOk = true; localAt = Date.now();
    } catch { localOk = false; }
  }
  function saveSoon(f: FileState) {
    clearTimeout(saveTimers.get(f.name));
    saveTimers.set(f.name, window.setTimeout(() => { saveTimers.delete(f.name); writeLocal(f); onChange(null); }, 300));
  }
  function flush() { for (const [name, t] of saveTimers) { clearTimeout(t); const f = files.get(name); if (f) writeLocal(f); } saveTimers.clear(); }

  // ---------- loading ----------
  /** Apply a local entry on top of the repo copy. Fields changed on GitHub since then come back as conflicts. */
  function restore(f: FileState, e: LocalEntry): Conflict[] {
    const out: Conflict[] = [];
    for (const [p, mine] of Object.entries(e.edits)) {
      const cur = getPtr(f.data, p);
      if (typeof cur !== 'string' || typeof mine !== 'string') continue; // field no longer exists
      if (norm(cur) === norm(mine)) continue; // already there
      if (e.sha === f.sha || cur === e.orig?.[p]) f.edits.set(p, mine);
      else out.push({ file: f.name, ptr: p, mine, theirs: cur });
    }
    return out;
  }
  async function load1(name: string): Promise<Conflict[]> {
    const path = `${SITE_DIR}/${name}.json`;
    try {
      const r = await loadJson(path);
      if (!r) { failed.set(name, `${name}.json isn’t in the repo yet.`); return []; }
      if (r.data === null || typeof r.data !== 'object') { failed.set(name, `${name}.json isn’t a JSON object.`); return []; }
      failed.delete(name);
      const f: FileState = { name, path, sha: r.sha, text: r.text, data: r.data, edits: new Map() };
      files.set(name, f);
      const e = readLocal(name);
      const conflicts = e ? restore(f, e) : [];
      if (e && !conflicts.length) writeLocal(f);
      return conflicts;
    } catch (e) {
      failed.set(name, (e as Error).message || `Couldn’t load ${name}.json`);
      return [];
    }
  }
  /** Load files not loaded yet (in parallel). Resolves with fields whose local edits conflict with newer repo copies. */
  async function ensure(names: string[]): Promise<Conflict[]> {
    const todo = [...new Set(names)].filter((n) => !files.has(n));
    const ps = todo.map((n) => {
      let p = loading.get(n);
      if (!p) { p = load1(n).finally(() => loading.delete(n)); loading.set(n, p); }
      return p;
    });
    const res = (await Promise.all(ps)).flat();
    if (todo.length) onChange([]);
    return res;
  }
  /** Settle conflicts from ensure(): keep mine → they become edits; otherwise use the repo's text. */
  function settle(cs: Conflict[], keepMine: boolean) {
    const touched = new Set<FileState>();
    for (const c of cs) {
      const f = files.get(c.file);
      if (!f) continue;
      if (keepMine) f.edits.set(c.ptr, c.mine);
      touched.add(f);
    }
    touched.forEach(writeLocal);
    onChange(cs.map((c) => `${c.file}:${c.ptr}`));
  }

  // ---------- editing ----------
  function set(k: Key, v: string, o: { undo?: boolean } = {}) {
    const p = parseKey(k); const f = p && files.get(p.file);
    const orig = original(k);
    if (!p || !f || orig === undefined) return;
    const before = value(k)!;
    if (before === v) return;
    if (o.undo !== false) {
      if (session?.key === k) { if (!session.pushed) { undos.push({ key: k, prev: session.prev }); session.pushed = true; } }
      else undos.push({ key: k, prev: before });
      if (undos.length > 200) undos.shift();
    }
    if (norm(v) === norm(orig)) f.edits.delete(p.ptr);
    else f.edits.set(p.ptr, v);
    saveSoon(f);
    onChange([k]);
  }
  /** Typing in a field: the whole run of typing until the next beginEdit is one undo step. */
  function beginEdit(k: Key) { const v = value(k); session = v === undefined ? null : { key: k, prev: v, pushed: false }; }
  function endEdit() { session = null; }
  function undo(): Key | null {
    session = null;
    while (undos.length) {
      const u = undos.pop()!;
      if (value(u.key) === undefined || value(u.key) === u.prev) continue;
      set(u.key, u.prev, { undo: false });
      return u.key;
    }
    return null;
  }
  function revert(k: Key) { const o = original(k); if (o !== undefined) set(k, o); }
  function discardAll() {
    const keys: Key[] = [];
    for (const f of files.values()) { for (const p of f.edits.keys()) keys.push(`${f.name}:${p}`); f.edits.clear(); writeLocal(f); }
    // local edits for files that never loaded (e.g. they failed): drop those too
    for (const n of localFiles()) if (!files.has(n)) try { ls()?.removeItem(LOCAL + n); } catch {}
    undos.length = 0; session = null;
    onChange(keys);
  }
  /** Forget a failed load so the next ensure() tries again. */
  function retry(names: string[]) { names.forEach((n) => failed.delete(n)); }
  function changes(): Change[] {
    const out: Change[] = [];
    for (const f of files.values()) for (const [p, now] of f.edits) {
      const old = getPtr(f.data, p);
      if (typeof old === 'string') out.push({ key: `${f.name}:${p}`, file: f.name, ptr: p, old, now });
    }
    return out;
  }
  const changed = (k: Key) => { const p = parseKey(k); return !!(p && files.get(p.file)?.edits.has(p.ptr)); };

  // ---------- publishing ----------
  class PublishConflict extends Error {
    file: string; fields: Conflict[]; fresh: { sha: string; text: string; data: unknown } | null;
    constructor(file: string, fields: Conflict[], fresh: PublishConflict['fresh']) {
      super(`${file}.json changed on GitHub since you opened it.`); this.name = 'PublishConflict';
      this.file = file; this.fields = fields; this.fresh = fresh;
    }
  }
  /** Move a file onto a newer repo copy. Conflicting fields keep mine (keepMine) or take the repo's. */
  function rebase(name: string, fresh: { sha: string; text: string; data: unknown }, keepMine: boolean) {
    const f = files.get(name);
    if (!f) return;
    const old = f.data;
    f.sha = fresh.sha; f.text = fresh.text; f.data = fresh.data;
    for (const [p, mine] of [...f.edits]) {
      const cur = getPtr(fresh.data, p);
      if (typeof cur !== 'string') { f.edits.delete(p); continue; }
      if (cur !== getPtr(old, p) && !keepMine) f.edits.delete(p);
      else if (norm(cur) === norm(mine)) f.edits.delete(p);
    }
    writeLocal(f);
    onChange([]); // repo values changed: everything re-renders
  }
  async function conflictsWithRepo(f: FileState) {
    const fresh = await loadJson(f.path);
    if (!fresh) return { fresh: null, fields: [...f.edits].map(([ptr, mine]) => ({ file: f.name, ptr, mine, theirs: '' })) };
    if (fresh.sha === f.sha) return { fresh, fields: [] as Conflict[] };
    const fields: Conflict[] = [];
    for (const [ptr, mine] of f.edits) {
      const cur = getPtr(fresh.data, ptr), was = getPtr(f.data, ptr);
      if (cur !== was) fields.push({ file: f.name, ptr, mine, theirs: typeof cur === 'string' ? cur : '' });
    }
    return { fresh, fields };
  }
  /**
   * Commit every changed file. Before each write, compares with GitHub: a newer copy that
   * changed other fields is merged quietly; one that changed the same fields throws
   * PublishConflict (nothing else of that file is written). Returns the last commit.
   */
  async function publish(): Promise<{ commit: SavedFile['commit']; files: string[] } | null> {
    flush();
    session = null;
    const dirty = [...files.values()].filter((f) => f.edits.size);
    let last: SavedFile['commit'] | null = null;
    const done: string[] = [];
    for (const f of dirty) {
      const { fresh, fields } = await conflictsWithRepo(f);
      if (fields.length || !fresh) throw new PublishConflict(f.name, fields, fresh);
      if (fresh.sha !== f.sha) rebase(f.name, fresh, true);
      if (!f.edits.size) continue;
      const snap = new Map(f.edits);
      const next = structuredClone(f.data);
      for (const [p, v] of snap) setPtr(next, p, norm(v));
      const content = serialize(next, f.text);
      const n = snap.size;
      try {
        await saveFiles([{ path: f.path, content, expectSha: f.sha }], `Site: edit ${f.name} (${n} ${n === 1 ? 'field' : 'fields'})`, {
          onSaved: (r) => {
            f.sha = r.sha; f.text = content; f.data = next;
            for (const [p, v] of snap) if (f.edits.get(p) === v) f.edits.delete(p); // edits typed during the save stay
            writeLocal(f);
            last = r.commit;
            done.push(f.name);
          },
        });
      } catch (e) {
        if (e instanceof FileConflictError) {
          const again = await conflictsWithRepo(f);
          throw new PublishConflict(f.name, again.fields, again.fresh);
        }
        throw e;
      }
    }
    onChange([]);
    return last ? { commit: last, files: done } : null;
  }

  return {
    files, failed, ensure, retry, settle, value, original, set, beginEdit, endEdit, undo, revert, discardAll, changes, changed, publish, rebase,
    fileOf, flush, PublishConflict,
    get count() { let n = 0; for (const f of files.values()) n += f.edits.size; return n; },
    get canUndo() { return undos.length > 0; },
    get localOk() { return localOk; },
    get localAt() { return localAt; },
    /** Edits saved on this device for files that couldn't be loaded (kept, not shown). */
    orphaned: () => localFiles().filter((n) => !files.has(n)),
  };
}
export type SiteState = ReturnType<typeof createSiteState>;
