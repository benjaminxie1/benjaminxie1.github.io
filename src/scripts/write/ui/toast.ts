// Transient messages ("Cover added", editor notices). One at a time, polite live region.
import { h } from './dom';

let host: HTMLElement | null = null;
let timer = 0;

export function toast(msg: string, o: { kind?: 'info' | 'error' | 'ok'; ms?: number; action?: { label: string; run: () => void } } = {}) {
  if (!host) {
    host = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(host);
  }
  clearTimeout(timer);
  host.replaceChildren();
  const t = h('div', { class: `toast toast-${o.kind || 'info'}` }, h('span', { text: msg }));
  if (o.action) {
    const a = o.action;
    t.append(h('button', { type: 'button', class: 'toast-act', text: a.label, on: { click: () => { dismiss(); a.run(); } } }));
  }
  t.append(h('button', { type: 'button', class: 'toast-x', 'aria-label': 'Dismiss', text: '×', on: { click: dismiss } }));
  host.append(t);
  requestAnimationFrame(() => t.classList.add('in'));
  timer = window.setTimeout(dismiss, o.ms ?? (o.action ? 7000 : 3500));
}
export function dismiss() {
  clearTimeout(timer);
  host?.replaceChildren();
}

/** Screen-reader-only announcements for important state changes. */
let sr: HTMLElement | null = null;
export function announce(msg: string) {
  if (!sr) { sr = h('div', { class: 'sr-only', 'aria-live': 'polite' }); document.body.append(sr); }
  sr.textContent = '';
  setTimeout(() => { sr!.textContent = msg; }, 30);
}
