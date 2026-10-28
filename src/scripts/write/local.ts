// Per-post local drafts in localStorage (STUB: DATA workstream hardens this).
import { type Doc, store } from './lib';

export type LocalEntry = { doc: Doc; dirty: boolean; savedAt: number };
const PREFIX = 'bx-write:local:';
const LAST = 'bx-write:last';
let newId = '';
export function keyOf(doc: Doc): string {
  if (doc.path) return doc.path;
  if (!(doc as any)._localId) (doc as any)._localId = newId || (newId = Math.random().toString(36).slice(2, 9));
  return 'new:' + (doc as any)._localId;
}
export function saveLocal(doc: Doc, dirty: boolean): boolean {
  return store.set(PREFIX + keyOf(doc), JSON.stringify({ doc, dirty, savedAt: Date.now() }));
}
export function loadLocal(key: string): LocalEntry | null {
  try { const v = store.get(PREFIX + key); return v ? JSON.parse(v) : null; } catch { return null; }
}
export function listLocal(): Array<{ key: string } & LocalEntry> {
  const out: Array<{ key: string } & LocalEntry> = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (!k.startsWith(PREFIX)) continue;
      const e = loadLocal(k.slice(PREFIX.length));
      if (e) out.push({ key: k.slice(PREFIX.length), ...e });
    }
  } catch {}
  return out;
}
export function clearLocal(key: string) { store.del(PREFIX + key); }
export function lastOpened() { return store.get(LAST); }
export function setLastOpened(key: string) { store.set(LAST, key); }
