// Small DOM + platform helpers shared by the editor UI pieces.
import { computePosition, autoUpdate, offset, flip, shift, type Placement, type VirtualElement } from '@floating-ui/dom';

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
export const MOD = isMac ? '⌘' : 'Ctrl';
export const SHIFT = isMac ? '⇧' : 'Shift';
export const ALT = isMac ? '⌥' : 'Alt';
/** "Mod-Shift-x" → "⌘⇧X" / "Ctrl+Shift+X" */
export const keyLabel = (k: string) =>
  k
    .split('-')
    .map((p) => (p === 'Mod' ? MOD : p === 'Shift' ? SHIFT : p === 'Alt' ? ALT : p.length === 1 ? p.toUpperCase() : p))
    .join(isMac ? '' : '+');

type Attrs = Record<string, string | number | boolean | null | undefined | EventListener>;
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: Array<Node | string | null | undefined | false>): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'html') el.innerHTML = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids) if (kid != null && kid !== false) el.append(kid);
  return el;
}

/** Keep focus (and the text selection) in the editor when a control is pressed. */
export const keepFocus = (el: HTMLElement) => el.addEventListener('mousedown', (e) => {
  const t = e.target as HTMLElement;
  if (!t.closest('input, textarea')) e.preventDefault();
});

export const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Phone-ish: a coarse pointer, or a narrow screen. */
export const isCompact = () => typeof matchMedia !== 'undefined' && (matchMedia('(max-width: 640px)').matches || matchMedia('(pointer: coarse)').matches);

// Minimal stroke icons (16px, currentColor) so the controls stay light.
const svg = (d: string, extra = '') => `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
export const icons = {
  bold: '<span class="ed-glyph ed-b" aria-hidden="true">B</span>',
  italic: '<span class="ed-glyph ed-i" aria-hidden="true">I</span>',
  strike: '<span class="ed-glyph ed-s" aria-hidden="true">S</span>',
  code: svg('<path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5"/>'),
  link: svg('<path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.2-2.2a2.6 2.6 0 0 0-3.7-3.7l-.7.7"/><path d="M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.3 9a2.6 2.6 0 0 0 3.7 3.7l.7-.7"/>'),
  h2: '<span class="ed-glyph ed-h" aria-hidden="true">H2</span>',
  h3: '<span class="ed-glyph ed-h" aria-hidden="true">H3</span>',
  quote: svg('<path d="M3 4.5v7M6.5 5.5h6.5M6.5 8h6.5M6.5 10.5h4"/>'),
  ul: svg('<circle cx="3" cy="4.5" r=".7" fill="currentColor"/><circle cx="3" cy="8" r=".7" fill="currentColor"/><circle cx="3" cy="11.5" r=".7" fill="currentColor"/><path d="M6 4.5h7.5M6 8h7.5M6 11.5h7.5"/>'),
  ol: svg('<path d="M2.4 3.6h1v3M2.2 6.6h1.6M2.3 9.6c.3-.5 1.6-.6 1.6.3 0 .7-1.6 1.3-1.6 2h1.7M6.5 4.5h7M6.5 8h7M6.5 11.5h7"/>'),
  image: svg('<rect x="2" y="3" width="12" height="10" rx="2"/><circle cx="6" cy="6.6" r="1.1"/><path d="m2.6 12 3.9-3.6 2.6 2.3 1.7-1.5 2.6 2.4"/>'),
  codeBlock: svg('<rect x="2" y="2.5" width="12" height="11" rx="2"/><path d="m6.2 6.3-1.7 1.7 1.7 1.7M9.8 6.3l1.7 1.7-1.7 1.7"/>'),
  hr: svg('<path d="M2.5 8h11"/>'),
  plus: svg('<path d="M8 3.5v9M3.5 8h9"/>'),
  open: svg('<path d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5M12 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3"/>'),
  trash: svg('<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.2a1 1 0 0 0 1 .8h3.8a1 1 0 0 0 1-.8l.6-8.2"/>'),
  edit: svg('<path d="M10.5 2.8 13.2 5.5 6 12.7 3 13l.3-3z"/>'),
  heading: '<span class="ed-glyph ed-h" aria-hidden="true">H</span>',
  sub: '<span class="ed-glyph ed-h ed-h-sm" aria-hidden="true">H</span>',
  keyboard: svg('<rect x="1.5" y="4" width="13" height="8.5" rx="1.6"/><path d="M4 6.6h.01M6.5 6.6h.01M9 6.6h.01M11.5 6.6h.01M4.5 9.8h7"/>'),
  close: svg('<path d="m4 4 8 8M12 4l-8 8"/>'),
  alt: '<span class="ed-glyph ed-alt" aria-hidden="true">Alt</span>',
};

export const iconButton = (opts: { icon: string; label: string; shortcut?: string; cls?: string; onClick: (e: MouseEvent) => void; pressable?: boolean }) => {
  const tip = opts.shortcut ? `${opts.label} (${keyLabel(opts.shortcut)})` : opts.label;
  const b = h('button', { type: 'button', class: 'ed-btn ' + (opts.cls || ''), 'aria-label': opts.label, 'data-tip': tip, html: opts.icon });
  if (opts.pressable) b.setAttribute('aria-pressed', 'false');
  b.addEventListener('click', opts.onClick as EventListener);
  return b;
};

/** A floating element anchored to a (virtual) reference, kept in place while open. */
export class Floater {
  el: HTMLElement;
  private stop: (() => void) | null = null;
  constructor(el: HTMLElement, private placement: Placement = 'bottom', private gap = 8) {
    this.el = el;
    el.classList.add('ed-floater');
  }
  get open() { return this.stop !== null; }
  show(getRect: () => DOMRect | null, placement = this.placement) {
    this.hide();
    const ref: VirtualElement = { getBoundingClientRect: () => getRect() || new DOMRect() };
    if (!this.el.isConnected) document.body.append(this.el);
    this.el.style.opacity = '0';
    this.el.hidden = false;
    const update = () =>
      computePosition(ref, this.el, { placement, strategy: 'absolute', middleware: [offset(this.gap), flip({ padding: 8 }), shift({ padding: 8 })] }).then(({ x, y }) => {
        Object.assign(this.el.style, { left: `${x}px`, top: `${y}px`, opacity: '1' });
      });
    this.stop = autoUpdate(ref, this.el, update, { animationFrame: false });
  }
  hide() {
    if (this.stop) { this.stop(); this.stop = null; }
    this.el.hidden = true;
    this.el.remove();
  }
}
