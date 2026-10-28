// Other tabs and the network.
// - Tabs announce which post they have open (BroadcastChannel), so a tab can say
//   "also open in another tab".
// - When another tab writes this post's local copy, the host hears about it (storage event)
//   and can adopt it or ask, instead of the two tabs silently overwriting each other.
// - Online/offline changes are reported as they happen.
import type { LocalEntry } from '../local';

const PREFIX = 'bx-write:local:';

export type PresenceHost = {
  key(): string;
  /** How many other tabs have the current post open. */
  onPeers(n: number): void;
  /** Another tab saved this post on this device. */
  onLocalChange(e: LocalEntry): void;
  onNetwork(online: boolean): void;
};

export function watchPresence(host: PresenceHost) {
  const me = Math.random().toString(36).slice(2, 10);
  const peers = new Map<string, { key: string; at: number }>();
  let ch: BroadcastChannel | null = null;
  try { ch = new BroadcastChannel('bx-write'); } catch {}
  let last = -1;

  const count = () => {
    const k = host.key();
    const now = Date.now();
    let n = 0;
    for (const [id, p] of peers) { if (now - p.at > 65e3) peers.delete(id); else if (p.key === k) n++; }
    return n;
  };
  const report = () => { const n = count(); if (n !== last) { last = n; host.onPeers(n); } };
  const post = (m: Record<string, unknown>) => { try { ch?.postMessage({ ...m, id: me }); } catch {} };
  const here = (ask = false) => post({ t: 'here', key: host.key(), ask });

  if (ch) {
    ch.onmessage = (ev) => {
      const m = ev.data as { t: string; id: string; key?: string; ask?: boolean };
      if (!m || m.id === me) return;
      if (m.t === 'here' && typeof m.key === 'string') { peers.set(m.id, { key: m.key, at: Date.now() }); if (m.ask) here(); }
      else if (m.t === 'bye') peers.delete(m.id);
      report();
    };
  }
  window.addEventListener('storage', (e) => {
    if (!e.key || e.key !== PREFIX + host.key() || !e.newValue) return;
    try {
      const v = JSON.parse(e.newValue);
      if (v && v.doc && typeof v.doc.html === 'string') host.onLocalChange({ doc: v.doc, dirty: !!v.dirty, savedAt: +v.savedAt || Date.now() });
    } catch {}
  });
  window.addEventListener('pagehide', () => post({ t: 'bye' }));
  window.addEventListener('online', () => host.onNetwork(true));
  window.addEventListener('offline', () => host.onNetwork(false));
  const beat = window.setInterval(() => { here(); report(); }, 20e3);
  here(true);

  return {
    /** Call when the open post changes. */
    moved() { here(); last = -1; report(); },
    online: () => navigator.onLine !== false,
    stop() { clearInterval(beat); post({ t: 'bye' }); ch?.close(); },
  };
}
