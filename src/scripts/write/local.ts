// Per-post local drafts in localStorage. Every call is safe: storage can be full,
// disabled (private mode) or contain junk; nothing here throws.
import { type Doc, LOCAL_KEY } from './lib';

export type LocalEntry = { doc: Doc; dirty: boolean; savedAt: number };
const PREFIX = 'bx-write:local:';
const LAST = 'bx-write:last';

const ls = (): Storage | null => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } };
const newId = () => {
  try { return crypto.randomUUID().replace(/-/g, '').slice(0, 12); } catch { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
};

/** Storage key for a doc: its repo path, or 'new:<localId>' (localId is created once and kept on the doc). */
export function keyOf(doc: Doc): string {
  if (doc.path) return doc.path;
  if (!doc.localId) doc.localId = newId();
  return 'new:' + doc.localId;
}

const valid = (e: any): e is LocalEntry =>
  !!e && typeof e === 'object' && !!e.doc && typeof e.doc === 'object' && typeof e.doc.html === 'string' && typeof e.savedAt === 'number';

function entries(): Array<{ key: string } & LocalEntry> {
  const s = ls();
  const out: Array<{ key: string } & LocalEntry> = [];
  if (!s) return out;
  try {
    const keys: string[] = [];
    for (let i = 0; i < s.length; i++) { const k = s.key(i); if (k && k.startsWith(PREFIX)) keys.push(k); }
    for (const k of keys) {
      try { const e = JSON.parse(s.getItem(k) || 'null'); if (valid(e)) out.push({ key: k.slice(PREFIX.length), ...e, dirty: !!e.dirty }); } catch {}
    }
  } catch {}
  return out;
}

/** Saves the doc locally. When storage is full, drops the oldest clean (already-saved) copies and retries once. */
export function saveLocal(doc: Doc, dirty: boolean): boolean {
  const s = ls();
  if (!s) return false;
  const key = keyOf(doc);
  let value: string;
  try { value = JSON.stringify({ doc, dirty, savedAt: Date.now() }); } catch { return false; }
  const write = () => { try { s.setItem(PREFIX + key, value); return true; } catch { return false; } };
  let ok = write();
  if (!ok) {
    const clean = entries().filter((e) => !e.dirty && e.key !== key).sort((a, b) => a.savedAt - b.savedAt);
    for (const e of clean) { try { s.removeItem(PREFIX + e.key); } catch {} if ((ok = write())) break; }
  }
  // a new doc that now has a repo path: its 'new:<id>' copy is superseded
  if (ok && doc.path && doc.localId) { try { s.removeItem(PREFIX + 'new:' + doc.localId); } catch {} }
  return ok;
}

export function loadLocal(key: string): LocalEntry | null {
  const s = ls();
  if (!s) return null;
  try {
    const e = JSON.parse(s.getItem(PREFIX + key) || 'null');
    return valid(e) ? { doc: e.doc, dirty: !!e.dirty, savedAt: e.savedAt } : null;
  } catch { return null; }
}

/** All local copies, newest first. Migrates the single draft kept by the first editor version. */
export function listLocal(): Array<{ key: string } & LocalEntry> {
  migrateLegacy();
  return entries().sort((a, b) => b.savedAt - a.savedAt);
}

export function clearLocal(key: string): void { try { ls()?.removeItem(PREFIX + key); } catch {} }
export function lastOpened(): string | null { try { return ls()?.getItem(LAST) ?? null; } catch { return null; } }
export function setLastOpened(key: string): void { try { ls()?.setItem(LAST, key); } catch {} }

let migrated = false;
function migrateLegacy() {
  if (migrated) return;
  migrated = true;
  const s = ls();
  if (!s) return;
  try {
    const raw = s.getItem(LOCAL_KEY);
    if (!raw) return;
    const v = JSON.parse(raw); // { doc, dirty }
    const doc = v && v.doc;
    if (doc && typeof doc === 'object' && typeof doc.html === 'string') {
      const key = keyOf(doc as Doc);
      if (loadLocal(key) || saveLocal(doc as Doc, !!v.dirty)) s.removeItem(LOCAL_KEY);
    } else s.removeItem(LOCAL_KEY);
  } catch {}
}
