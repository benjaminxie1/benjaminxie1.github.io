// Item controls inside the edited page: hovering, focusing or tapping a list item shows a
// small toolbar (drag handle, move, duplicate, delete, details); "+ Add …" sits at the end
// of a list while you're in it (and always in an empty one). Items drag to reorder (pointer
// or touch, on the handle) and move with Alt+↑/↓ or the handle's arrow keys.
// Like layer.ts this runs in the /write page and reaches into the same-origin iframe.
import { parseKey, type Key } from './pointer';

export type ItemsHost = {
  editable(): boolean;
  /** The list's file is loaded and it can be edited. */
  ready(listKey: Key): boolean;
  count(listKey: Key): number;
  limits(listKey: Key): { min: number; max: number };
  label(listKey: Key): string; // "job"
  canAdd(listKey: Key): boolean;
  add(listKey: Key): void;
  duplicate(itemKey: Key): void;
  remove(itemKey: Key): void;
  move(listKey: Key, from: number, to: number, how: 'drag' | 'key'): void;
  details(itemKey: Key, focus?: Key): void;
  select(itemKey: Key | null): void;
  selected(): Key | null;
};

const isEl = (n: unknown): n is HTMLElement => !!n && (n as Node).nodeType === 1;
const shown = (el: Element | null | undefined) => !!el && el.getClientRects().length > 0;
const listOf = (itemKey: Key) => itemKey.slice(0, itemKey.lastIndexOf('/'));
const indexOf = (itemKey: Key) => +itemKey.slice(itemKey.lastIndexOf('/') + 1);

const ICON = {
  grip: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><g fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></g></svg>',
  up: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  down: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  left: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  right: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  dup: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M9 9h10v10H9zM5 15V5h10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  del: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};

const PAGE_CSS = `
html.bx-on [data-edit-item] { transition: outline-color .12s, opacity .15s; outline: 1.5px solid transparent; outline-offset: 5px; border-radius: 6px; }
html.bx-on [data-edit-item].bx-hov { outline-color: rgba(47, 107, 69, .22); }
html.bx-on [data-edit-item].bx-sel { outline-color: rgba(47, 107, 69, .55); }
html.bx-on [data-edit-item].bx-lift { opacity: .38; }
html.bx-dragging, html.bx-dragging * { cursor: grabbing !important; user-select: none !important; -webkit-user-select: none !important; }
@media (prefers-reduced-motion: reduce) { html.bx-on [data-edit-item] { transition: none; } }
`;
const UI_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.itb, .add, .drop, .ghost { position: absolute; z-index: 2147482990; font: 12.5px/1 'Comfortaa Variable', system-ui, sans-serif; color: #22211e; }
.itb { display: flex; align-items: center; gap: 1px; padding: 3px; background: #f8f6f1; border: 1px solid #e6e1d6; border-radius: 10px; box-shadow: 0 8px 22px rgba(34, 33, 30, .13), 0 1px 4px rgba(34, 33, 30, .06); }
.itb[hidden], .add[hidden], .drop[hidden], .ghost[hidden] { display: none; }
.itb .kind { padding: 0 7px 0 5px; color: #67625a; font-size: 12px; white-space: nowrap; max-width: 150px; overflow: hidden; text-overflow: ellipsis; }
.itb button { font: inherit; color: inherit; background: none; border: 0; border-radius: 7px; min-width: 28px; height: 28px; padding: 0 6px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 5px; }
.itb button:hover:not(:disabled) { background: #efebe2; }
.itb button:disabled { opacity: .35; cursor: default; }
.itb button.del:hover:not(:disabled) { color: #b5452f; }
.itb .grip { cursor: grab; touch-action: none; color: #67625a; }
.itb .sep { width: 1px; height: 18px; background: #e6e1d6; margin: 0 3px; }
.itb .det { padding: 0 9px; }
.add { display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 10px 0 8px; border-radius: 99px; border: 1px dashed rgba(47, 107, 69, .55); background: rgba(248, 246, 241, .96); color: #2f6b45; cursor: pointer; white-space: nowrap; box-shadow: 0 2px 8px rgba(34, 33, 30, .06); }
.add:hover:not(:disabled) { border-style: solid; background: #fff; }
.add:disabled { opacity: .5; cursor: default; color: #67625a; border-color: #e6e1d6; }
.add.empty { border-radius: 9px; height: 32px; padding: 0 12px; }
.drop { background: #2f6b45; border-radius: 2px; pointer-events: none; box-shadow: 0 0 0 2px rgba(248, 246, 241, .9); }
.ghost { pointer-events: none; padding: 5px 10px; border-radius: 8px; background: #22211e; color: #f8f6f1; font-size: 12.5px; box-shadow: 0 8px 20px rgba(34, 33, 30, .25); white-space: nowrap; }
button:focus-visible { outline: 2px solid #2f6b45; outline-offset: 1px; }
@media (pointer: coarse) { .itb button { min-width: 38px; height: 38px; } .add { height: 34px; padding: 0 13px 0 11px; font-size: 13.5px; } }
`;

export function attachItems(win: Window, host: ItemsHost) {
  const doc = win.document;
  const ac = new AbortController();
  const on = (t: EventTarget, ev: string, fn: (e: any) => void, opts: AddEventListenerOptions = {}) => t.addEventListener(ev, fn, { capture: true, ...opts, signal: ac.signal });

  const style = doc.createElement('style');
  style.textContent = PAGE_CSS;
  doc.head.append(style);
  const uiHost = doc.createElement('bx-items-ui');
  uiHost.setAttribute('style', 'position:absolute;top:0;left:0;width:0;height:0;z-index:2147482990;');
  const shadow = uiHost.attachShadow({ mode: 'open' });
  const mk = (tag: string, attrs: Record<string, string> = {}, html = '') => {
    const e = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (html) e.innerHTML = html;
    return e as HTMLElement;
  };
  const css = mk('style'); css.textContent = UI_CSS;
  const tb = mk('div', { class: 'itb', role: 'toolbar', hidden: '' });
  const kind = mk('span', { class: 'kind' });
  const grip = mk('button', { type: 'button', class: 'grip' }, ICON.grip);
  const upB = mk('button', { type: 'button', class: 'up' });
  const downB = mk('button', { type: 'button', class: 'down' });
  const dupB = mk('button', { type: 'button', class: 'dup' }, ICON.dup);
  const delB = mk('button', { type: 'button', class: 'del' }, ICON.del);
  const detB = mk('button', { type: 'button', class: 'det' }, 'Details');
  tb.append(grip, kind, upB, downB, dupB, delB, mk('span', { class: 'sep', 'aria-hidden': 'true' }), detB);
  const drop = mk('div', { class: 'drop', hidden: '' });
  const ghost = mk('div', { class: 'ghost', hidden: '', 'aria-hidden': 'true' });
  const live = mk('div', { 'aria-live': 'polite', style: 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)' });
  const adds = mk('div');
  shadow.append(css, tb, adds, drop, ghost, live);
  doc.body.append(uiHost);

  // ---------- which item ----------
  let hov: HTMLElement | null = null;   // under the pointer
  let cur: HTMLElement | null = null;   // the toolbar's item
  let hovList: HTMLElement | null = null;
  let overUi = false;
  const keyOf = (el: Element | null) => el?.getAttribute('data-edit-item') || null;
  const usable = (el: Element | null): boolean => {
    const k = keyOf(el);
    return !!k && !!parseKey(k) && host.editable() && host.ready(listOf(k)) && !el!.closest('template') && shown(el as HTMLElement);
  };
  const itemAt = (n: Node | null): HTMLElement | null => {
    let e: HTMLElement | null = isEl(n) ? n : ((n as Node | null)?.parentElement ?? null);
    while (e) { const it = e.closest('[data-edit-item]') as HTMLElement | null; if (!it) return null; if (usable(it)) return it; e = it.parentElement; }
    return null;
  };
  const byKey = (k: Key | null) => (k ? doc.querySelector<HTMLElement>(`[data-edit-item="${CSS.escape(k)}"]`) : null);
  const orientation = (listEl: Element): 'v' | 'h' => {
    const its = [...listEl.children].filter((c) => c.hasAttribute('data-edit-item')) as HTMLElement[];
    if (its.length >= 2) { const a = its[0].getBoundingClientRect(), b = its[1].getBoundingClientRect(); return Math.abs(a.top - b.top) < Math.min(a.height, b.height) / 2 ? 'h' : 'v'; }
    const d = win.getComputedStyle(listEl);
    return (d.display.includes('flex') && !d.flexDirection.startsWith('column')) || /^(inline|contents)$/.test(win.getComputedStyle(its[0] || listEl).display) ? 'h' : 'v';
  };
  const listElOf = (it: Element) => it.parentElement as HTMLElement;

  // ---------- painting ----------
  let raf = 0;
  const paintSoon = () => { cancelAnimationFrame(raf); raf = win.requestAnimationFrame(paint); };
  function paint() {
    const sel = byKey(host.selected());
    doc.querySelectorAll('.bx-sel, .bx-hov').forEach((e) => { if (e !== sel) e.classList.remove('bx-sel'); if (e !== hov) e.classList.remove('bx-hov'); });
    if (sel && usable(sel)) sel.classList.add('bx-sel');
    if (hov && hov !== sel && usable(hov)) hov.classList.add('bx-hov');
    if (!drag) cur = hov && usable(hov) ? hov : sel && usable(sel) ? sel : (overUi ? cur : null);
    if (cur && !cur.isConnected) cur = null;
    paintToolbar();
    paintAdds();
  }
  function paintToolbar() {
    if (!cur || !host.editable()) { tb.hidden = true; return; }
    const k = keyOf(cur)!, L = listOf(k), i = indexOf(k);
    const n = host.count(L), lim = host.limits(L);
    const lab = host.label(L);
    const h = orientation(listElOf(cur)) === 'h';
    kind.textContent = lab.charAt(0).toUpperCase() + lab.slice(1);
    upB.innerHTML = h ? ICON.left : ICON.up;
    downB.innerHTML = h ? ICON.right : ICON.down;
    const set = (b: HTMLElement, label: string, dis: boolean, why = '') => { b.setAttribute('aria-label', label); b.title = dis && why ? why : label; (b as HTMLButtonElement).disabled = dis; };
    set(grip, `Drag to reorder this ${lab} (or use the arrow keys)`, n < 2);
    set(upB, h ? `Move ${lab} left` : `Move ${lab} up`, i <= 0);
    set(downB, h ? `Move ${lab} right` : `Move ${lab} down`, i >= n - 1);
    set(dupB, `Duplicate ${lab}`, n >= lim.max, `At most ${lim.max} ${lab}s`);
    set(delB, `Delete ${lab}`, n <= lim.min, `Keep at least ${lim.min} ${lim.min === 1 ? lab : lab + 's'}`);
    detB.setAttribute('aria-label', `${lab} details`); detB.title = `Edit every detail of this ${lab}`;
    tb.setAttribute('aria-label', `${lab} ${i + 1} of ${n}`);
    tb.hidden = false;
    const r = cur.getBoundingClientRect();
    const vw = doc.documentElement.clientWidth;
    const w = tb.offsetWidth, hh = tb.offsetHeight;
    let top = r.top - hh - 8;
    if (top < 4) top = Math.min(r.bottom + 8, win.innerHeight - hh - 4);
    const left = Math.max(6, Math.min(vw - w - 6, r.right - w + 4));
    tb.style.top = `${top + win.scrollY}px`;
    tb.style.left = `${left + win.scrollX}px`;
  }
  const addBtns = new Map<string, HTMLButtonElement>();
  function paintAdds() {
    const want = new Set<string>();
    if (host.editable()) {
      const ctxItems = [hov, cur, byKey(host.selected())].filter(Boolean) as HTMLElement[];
      for (const listEl of doc.querySelectorAll<HTMLElement>('[data-edit-list]')) {
        const L = listEl.getAttribute('data-edit-list')!;
        if (!parseKey(L) || listEl.closest('template') || !host.ready(L) || !host.canAdd(L)) continue;
        const its = [...listEl.children].filter((c) => c.hasAttribute('data-edit-item')) as HTMLElement[];
        if (its.length && !its.some(shown)) continue;
        if (!its.length && (listEl.closest('[hidden]') || !shown(listEl.parentElement))) continue;
        const near = !its.length || hovList === listEl || ctxItems.some((c) => c.parentElement === listEl);
        if (!near) continue;
        want.add(L);
        let b = addBtns.get(L);
        if (!b) {
          b = mk('button', { type: 'button', class: 'add' }) as HTMLButtonElement;
          b.addEventListener('click', () => host.add(L));
          b.addEventListener('pointerenter', () => { overUi = true; });
          b.addEventListener('pointerleave', () => { overUi = false; });
          addBtns.set(L, b); adds.append(b);
        }
        const lab = host.label(L), lim = host.limits(L), n = host.count(L);
        b.innerHTML = `${ICON.plus}<span>Add ${lab}</span>`;
        b.classList.toggle('empty', !its.length);
        b.disabled = n >= lim.max;
        b.title = n >= lim.max ? `At most ${lim.max} ${lab}s` : `Add a ${lab} at the end`;
        b.hidden = false;
        const vw = doc.documentElement.clientWidth;
        let top: number, left: number;
        if (!its.length) { const r = listEl.getBoundingClientRect(); top = r.top; left = r.left; }
        else {
          const last = its[its.length - 1].getBoundingClientRect();
          if (orientation(listEl) === 'h') { top = last.top + last.height / 2 - b.offsetHeight / 2; left = last.right + 10; if (left + b.offsetWidth > vw - 6) { left = last.left; top = last.bottom + 6; } }
          else { top = last.bottom + 6; left = last.left; }
        }
        b.style.top = `${top + win.scrollY}px`;
        b.style.left = `${Math.max(6, Math.min(vw - b.offsetWidth - 6, left)) + win.scrollX}px`;
      }
    }
    for (const [L, b] of addBtns) if (!want.has(L)) { if (b.matches(':focus')) continue; b.remove(); addBtns.delete(L); }
  }

  // ---------- pointer ----------
  let leaveT = 0, switchT = 0;
  const inUi = (e: Event) => e.composedPath().includes(uiHost);
  on(doc, 'pointermove', (e: PointerEvent) => {
    if (drag) return;
    if (inUi(e)) { overUi = true; clearTimeout(leaveT); clearTimeout(switchT); return; }
    overUi = false;
    const it = itemAt(e.target as Node);
    const L = (e.target as Element)?.closest?.('[data-edit-list]') as HTMLElement | null;
    if (it === hov && L === hovList) { clearTimeout(switchT); return; }
    clearTimeout(switchT);
    const go = () => { hov = it; hovList = L; paintSoon(); };
    // a short grace period so the pointer can travel from an item to its toolbar across a gap or a neighbour
    if (!hov || e.pointerType !== 'mouse' || tb.hidden) go(); else switchT = win.setTimeout(go, it ? 140 : 320);
  }, { passive: true });
  on(doc.documentElement, 'pointerleave', (e: PointerEvent) => {
    if (e.target !== doc.documentElement) return; // (capture sees every element's leave)
    clearTimeout(leaveT);
    leaveT = win.setTimeout(() => { if (!overUi && !drag) { hov = null; hovList = null; paintSoon(); } }, 250);
  }, { capture: false });
  on(doc, 'pointerdown', (e: PointerEvent) => {
    if (inUi(e)) return;
    const it = itemAt(e.target as Node);
    host.select(it ? keyOf(it) : null);
    if (e.pointerType !== 'mouse') { hov = it; paintSoon(); }
  });
  on(doc, 'click', (e: MouseEvent) => {
    if (inUi(e)) return;
    const img = (e.target as Element)?.closest?.('[data-edit-img]');
    const it = itemAt(e.target as Node);
    if (img && it && host.editable()) host.details(keyOf(it)!, img.getAttribute('data-edit-img')!);
  });
  on(doc, 'focusin', (e: FocusEvent) => {
    if (inUi(e)) return;
    const it = itemAt(e.target as Node);
    if (it) { host.select(keyOf(it)); paintSoon(); }
  });
  on(win, 'scroll', paintSoon, { passive: true, capture: false });
  on(win, 'resize', paintSoon, { capture: false });

  // ---------- toolbar actions ----------
  const act = (fn: (k: Key) => void) => () => { const k = keyOf(cur); if (k) fn(k); };
  on(upB, 'click', act((k) => host.move(listOf(k), indexOf(k), indexOf(k) - 1, 'key')));
  on(downB, 'click', act((k) => host.move(listOf(k), indexOf(k), indexOf(k) + 1, 'key')));
  on(dupB, 'click', act((k) => host.duplicate(k)));
  on(delB, 'click', act((k) => { cur = null; hov = null; host.remove(k); }));
  on(detB, 'click', act((k) => host.details(k)));
  on(tb, 'pointerenter', () => { overUi = true; clearTimeout(leaveT); });
  on(tb, 'pointerleave', () => { overUi = false; });
  on(grip, 'keydown', (e: KeyboardEvent) => {
    const k = keyOf(cur);
    if (!k) return;
    const d = e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : 0;
    if (!d) return;
    e.preventDefault();
    const to = indexOf(k) + d;
    if (to >= 0 && to < host.count(listOf(k))) host.move(listOf(k), indexOf(k), to, 'key');
  });

  // ---------- drag to reorder ----------
  let drag: { el: HTMLElement; list: HTMLElement; L: Key; from: number; to: number; axis: 'v' | 'h'; id: number; sx: number; sy: number; moved: boolean } | null = null;
  let scrollRaf = 0, lastY = 0;
  on(grip, 'pointerdown', (e: PointerEvent) => {
    if (!cur || e.button > 0 || (grip as HTMLButtonElement).disabled) return;
    e.preventDefault();
    const k = keyOf(cur)!;
    drag = { el: cur, list: listElOf(cur), L: listOf(k), from: indexOf(k), to: indexOf(k), axis: orientation(listElOf(cur)), id: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false };
    grip.setPointerCapture(e.pointerId);
  });
  on(grip, 'pointermove', (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
    if (!drag.moved) {
      drag.moved = true;
      drag.el.classList.add('bx-lift');
      doc.documentElement.classList.add('bx-dragging');
      tb.hidden = true;
      ghost.textContent = (host.label(drag.L).replace(/^./, (c) => c.toUpperCase())) + ' ' + (drag.from + 1);
      ghost.hidden = false;
    }
    lastY = e.clientY;
    ghost.style.left = `${e.clientX + 14 + win.scrollX}px`;
    ghost.style.top = `${e.clientY + 12 + win.scrollY}px`;
    const its = [...drag.list.children].filter((c) => c.hasAttribute('data-edit-item')) as HTMLElement[];
    const rs = its.map((x) => x.getBoundingClientRect());
    let ins = its.length;
    for (let i = 0; i < its.length; i++) {
      const r = rs[i];
      const before = drag.axis === 'v' ? e.clientY < r.top + r.height / 2 : (e.clientY < r.top ? true : e.clientY <= r.bottom && e.clientX < r.left + r.width / 2);
      if (before) { ins = i; break; }
    }
    drag.to = ins > drag.from ? ins - 1 : ins;
    // the drop line sits between the two items it would land between
    const a = rs[ins - 1], b = rs[ins];
    if (drag.to === drag.from) drop.hidden = true;
    else if (drag.axis === 'v') {
      const ref = b || a, y = a && b ? (a.bottom + b.top) / 2 : b ? b.top - 4 : a.bottom + 4;
      Object.assign(drop.style, { left: `${ref.left + win.scrollX}px`, width: `${ref.width}px`, top: `${y - 1.5 + win.scrollY}px`, height: '3px' });
      drop.hidden = false;
    } else {
      const ref = b || a, x = a && b && Math.abs(a.top - b.top) < 4 ? (a.right + b.left) / 2 : b ? b.left - 5 : a.right + 5;
      Object.assign(drop.style, { left: `${x - 1.5 + win.scrollX}px`, width: '3px', top: `${ref.top + win.scrollY}px`, height: `${ref.height}px` });
      drop.hidden = false;
    }
    if (!scrollRaf) scrollRaf = win.requestAnimationFrame(autoscroll);
  });
  function autoscroll() {
    scrollRaf = 0;
    if (!drag?.moved) return;
    const edge = 48, vh = win.innerHeight;
    const dy = lastY < edge ? -(edge - lastY) / 3 : lastY > vh - edge ? (lastY - (vh - edge)) / 3 : 0;
    if (dy) { win.scrollBy(0, dy); scrollRaf = win.requestAnimationFrame(autoscroll); }
  }
  function endDrag(commit: boolean) {
    if (!drag) return;
    const d = drag;
    drag = null;
    d.el.classList.remove('bx-lift');
    doc.documentElement.classList.remove('bx-dragging');
    drop.hidden = true; ghost.hidden = true;
    try { grip.releasePointerCapture(d.id); } catch {}
    if (commit && d.moved && d.to !== d.from) host.move(d.L, d.from, d.to, 'drag');
    cur = d.el;
    paintSoon();
  }
  on(grip, 'pointerup', () => endDrag(true));
  on(grip, 'pointercancel', () => endDrag(false));
  on(doc, 'keydown', (e: KeyboardEvent) => {
    if (drag && e.key === 'Escape') { e.preventDefault(); endDrag(false); return; }
    // Alt+↑/↓ moves the item you're in (the innermost one)
    if (!e.altKey || e.metaKey || e.ctrlKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    if (inUi(e)) return;
    const it = itemAt(doc.activeElement) || byKey(host.selected());
    if (!it || !usable(it)) return;
    e.preventDefault();
    const k = keyOf(it)!, i = indexOf(k), to = i + (e.key === 'ArrowUp' ? -1 : 1);
    if (to >= 0 && to < host.count(listOf(k))) host.move(listOf(k), i, to, 'key');
  });

  return {
    paint: paintSoon,
    /** Announce to screen readers inside the page. */
    say(msg: string) { live.textContent = ''; win.setTimeout(() => { live.textContent = msg; }, 30); },
    /** Keep the toolbar on an item after it moved (focus stays where it was). */
    follow(itemKey: Key | null) { const el = byKey(itemKey); if (el) cur = el; paintSoon(); },
    scrollTo(itemKey: Key) {
      const el = byKey(itemKey);
      if (!el) return false;
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      el.classList.remove('bx-flash'); void el.offsetWidth; el.classList.add('bx-flash');
      win.setTimeout(() => el.classList.remove('bx-flash'), 1200);
      return true;
    },
    destroy() { ac.abort(); cancelAnimationFrame(raf); style.remove(); uiHost.remove(); },
  };
}
