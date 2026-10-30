// The editing layer for a site page shown in the /write iframe. It runs in the /write
// page's script and reaches into the same-origin iframe document (the public pages
// carry no editing code at all): makes [data-edit] text editable, [data-edit-href] URLs
// editable via a popover, blocks navigation, and reports every change to the host.
// Nodes here belong to the iframe's realm, so no `instanceof` checks against our globals.
import { renderInline, inlineFromNode } from '../../../lib/inline';
import { parseKey, type Key } from './pointer';
import { norm } from './state';

export type FieldInfo = { key: Key; kind: 'plain' | 'inline' | 'href'; tag: string };
export type LayerHost = {
  value(k: Key): string | undefined;
  /** The file behind k has been loaded (or failed to): an undefined value then means the field is missing. */
  loaded(k: Key): boolean;
  changed(k: Key): boolean;
  set(k: Key, v: string): void;
  beginEdit(k: Key): void;
  endEdit(): void;
  editable(): boolean;
  /** Keyboard shortcuts that belong to the app (⌘S, ⌘Z outside a field). */
  command(name: 'save' | 'undo'): void;
  message(msg: string): void;
};
export type Layer = ReturnType<typeof attachLayer>;

const isEl = (n: unknown): n is HTMLElement => !!n && (n as Node).nodeType === 1;
const SAFE_URL = /^(https?:\/\/[^\s]+|mailto:[^\s]+|\/(?!\/)[^\s]*)$/i;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** What the person typed into a URL box → a URL the site accepts, or null. */
export function cleanUrl(raw: string): string | null {
  let u = raw.trim();
  if (!u) return null;
  if (/^[^\s@/:]+@[^\s@/]+\.[^\s@/]+$/.test(u)) u = 'mailto:' + u;
  else if (/^www\.|^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(u) && !/^[a-z]+:/i.test(u)) u = 'https://' + u;
  return SAFE_URL.test(u) ? u : null;
}

const BLOCKED_INPUT = /^(insertParagraph|insertLineBreak|insertOrderedList|insertUnorderedList|insertHorizontalRule|insertFromDrop|deleteByDrag|format(Underline|StrikeThrough|Superscript|Subscript|Justify.*|Indent|Outdent|SetBlockTextDirection|SetInlineTextDirection|BackColor|FontColor|FontName|Remove))$/;

const CSS = `
[data-edit], [data-edit-href] { border-radius: 3px; transition: outline-color .12s, background-color .12s; outline: 1.5px dashed transparent; outline-offset: 3px; }
html.bx-on [data-edit]:not(.bx-missing):hover, html.bx-on [data-edit-href]:not(.bx-missing):hover { outline-color: rgba(47, 107, 69, .45); }
html.bx-on [data-edit]:focus { outline: 2px solid rgba(47, 107, 69, .65); outline-offset: 3px; }
html.bx-on [data-edit] { cursor: text; caret-color: #2f6b45; }
html.bx-on [data-edit-href]:not([data-edit]) { cursor: pointer; }
html.bx-on [data-edit-kind="inline"] a { cursor: pointer; }
html.bx-on .bx-ch { background-color: rgba(181, 69, 47, .075); box-shadow: 0 0 0 3px rgba(181, 69, 47, .075); }
html.bx-on .bx-flash { animation: bx-flash 1.1s ease-out; }
@keyframes bx-flash { 0%, 30% { background-color: rgba(47, 107, 69, .22); box-shadow: 0 0 0 4px rgba(47, 107, 69, .22); } }
html.bx-on .bx-missing { opacity: .55; cursor: not-allowed; }
html.bx-on [data-edit]:empty::before { content: 'Empty'; color: rgba(103, 98, 90, .55); font-style: italic; }
html.bx-on a:not([data-edit]):not([data-edit-href]) { cursor: default; }
`;

const UI_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.tb, .pop {
  position: absolute; z-index: 2147483000; font: 13.5px/1.3 'Comfortaa Variable', system-ui, sans-serif; color: #22211e;
  background: #f8f6f1; border: 1px solid #e6e1d6; border-radius: 10px;
  box-shadow: 0 10px 28px rgba(34, 33, 30, .14), 0 2px 6px rgba(34, 33, 30, .06);
}
.tb { display: flex; gap: 2px; padding: 3px; }
.tb[hidden], .pop[hidden] { display: none; }
.tb button {
  font: inherit; color: inherit; background: none; border: 0; border-radius: 7px; min-width: 32px; height: 30px; padding: 0 8px; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
}
.tb button:hover { background: #f4f1ea; }
.tb button[aria-pressed="true"] { color: #2f6b45; background: rgba(47, 107, 69, .1); }
.tb .b { font-weight: 800; } .tb .i { font-style: italic; font-family: Georgia, serif; font-size: 15px; }
.pop { width: min(360px, calc(100vw - 24px)); padding: 10px; }
.pop label { display: block; font-size: 12px; font-weight: 600; color: #67625a; margin: 0 0 6px; }
.row { display: flex; gap: 6px; }
input {
  flex: 1; min-width: 0; font: inherit; font-size: 14px; color: #22211e; background: #fff; border: 1px solid #e6e1d6; border-radius: 8px; padding: 7px 9px;
}
input:focus { outline: 2px solid rgba(47, 107, 69, .55); border-color: #2f6b45; }
input[aria-invalid="true"] { border-color: #b5452f; outline-color: rgba(181, 69, 47, .5); }
.btn {
  font: inherit; font-size: 13px; color: #22211e; background: transparent; border: 1px solid #e6e1d6; border-radius: 8px; padding: 0 10px; min-height: 32px; cursor: pointer; white-space: nowrap;
}
.btn:hover { background: #f4f1ea; }
.btn.primary { background: #22211e; border-color: #22211e; color: #f8f6f1; }
.btn.primary:hover { background: #2f6b45; border-color: #2f6b45; color: #fff; }
.foot { display: flex; align-items: center; gap: 12px; margin-top: 8px; font-size: 12.5px; }
.foot a, .foot button.lk { color: #2f6b45; background: none; border: 0; padding: 0; font: inherit; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
.foot .rm { color: #b5452f; }
.foot .sp { flex: 1; }
.msg { color: #b5452f; font-size: 12.5px; margin: 6px 0 0; }
.msg:empty { display: none; }
button:focus-visible, a:focus-visible { outline: 2px solid #2f6b45; outline-offset: 1px; }
@media (pointer: coarse) { .tb button { min-width: 40px; height: 38px; } .btn { min-height: 38px; } input { font-size: 16px; } }
`;

export function attachLayer(win: Window, host: LayerHost) {
  const doc = win.document;
  const root = doc.documentElement;
  const ac = new AbortController();
  const on = (t: EventTarget, ev: string, fn: (e: any) => void, capture = true) => t.addEventListener(ev, fn, { capture, signal: ac.signal });
  const supportsPlain = (() => { const d = doc.createElement('div'); d.contentEditable = 'plaintext-only'; return d.contentEditable === 'plaintext-only'; })();

  const style = doc.createElement('style');
  style.id = 'bx-edit-style';
  style.textContent = CSS;
  doc.head.append(style);

  // UI (toolbar + link popover) in a shadow root so the page's styles can't touch it
  const uiHost = doc.createElement('bx-edit-ui');
  uiHost.setAttribute('style', 'position:absolute;top:0;left:0;width:0;height:0;z-index:2147483000;');
  const shadow = uiHost.attachShadow({ mode: 'open' });
  const mk = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text = '') => {
    const e = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text) e.textContent = text;
    return e;
  };
  const uiStyle = mk('style'); uiStyle.textContent = UI_CSS;
  const tb = mk('div', { class: 'tb', role: 'toolbar', 'aria-label': 'Format', hidden: '' });
  const bBtn = mk('button', { type: 'button', class: 'b', title: 'Bold (⌘B)', 'aria-label': 'Bold', 'aria-pressed': 'false' }, 'B');
  const iBtn = mk('button', { type: 'button', class: 'i', title: 'Italic (⌘I)', 'aria-label': 'Italic', 'aria-pressed': 'false' }, 'I');
  const lBtn = mk('button', { type: 'button', title: 'Link (⌘K)', 'aria-label': 'Link' }, 'Link');
  tb.append(bBtn, iBtn, lBtn);
  const pop = mk('div', { class: 'pop', role: 'dialog', 'aria-label': 'Link address', hidden: '' });
  const popLabel = mk('label', { for: 'bx-url' }, 'Link address');
  const urlIn = mk('input', { id: 'bx-url', type: 'text', inputmode: 'url', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: 'https://…' }) as HTMLInputElement;
  const applyBtn = mk('button', { type: 'button', class: 'btn primary' }, 'Apply');
  const row = mk('div', { class: 'row' }); row.append(urlIn, applyBtn);
  const msg = mk('p', { class: 'msg', role: 'alert' });
  const openA = mk('a', { target: '_blank', rel: 'noopener noreferrer' }, 'Open ↗');
  const rmBtn = mk('button', { type: 'button', class: 'lk rm' }, 'Remove link');
  const foot = mk('div', { class: 'foot' }); foot.append(openA, mk('span', { class: 'sp' }), rmBtn);
  pop.append(popLabel, row, msg, foot);
  shadow.append(uiStyle, tb, pop);
  doc.body.append(uiHost);

  // ---------- fields ----------
  const fieldOf = (n: Node | null): HTMLElement | null => {
    const e = n && (isEl(n) ? n : n.parentElement);
    const f = e?.closest?.('[data-edit]') as HTMLElement | null;
    return f && f.isContentEditable ? f : null;
  };
  const kindOf = (el: Element) => (el.getAttribute('data-edit-kind') === 'inline' ? 'inline' : 'plain');
  const all = () => [...doc.querySelectorAll<HTMLElement>('[data-edit], [data-edit-href]')];
  // mailto: links carry no URL marker; their address is site:/email, so they follow its edits
  const EMAIL: Key = 'site:/email';
  const mailtos = () => [...doc.querySelectorAll<HTMLAnchorElement>('a[href^="mailto:" i]:not([data-edit-href])')];
  function paintMailtos() {
    const v = host.value(EMAIL);
    if (v === undefined) return;
    for (const a of mailtos()) if (a.getAttribute('href') !== 'mailto:' + v) a.setAttribute('href', 'mailto:' + v);
  }

  /** Text of an inline field as inline markdown. Works on a copy in our realm, tidied first. */
  function readInline(el: HTMLElement): string {
    const c = document.importNode(el, true) as HTMLElement;
    // empty formatting (left behind by ⌘B on nothing) and whitespace at a mark's edges would make odd markdown
    for (const m of [...c.querySelectorAll('b, strong, i, em, a')].reverse()) {
      if (!m.textContent) { m.remove(); continue; }
      const lead = /^\s+/.exec(m.textContent)?.[0], trail = /\s+$/.exec(m.textContent)?.[0];
      const firstT = m.firstChild, lastT = m.lastChild;
      if (lead && firstT?.nodeType === 3) { firstT.textContent = firstT.textContent!.replace(/^\s+/, ''); m.before(' '); }
      if (trail && lastT?.nodeType === 3) { lastT.textContent = lastT.textContent!.replace(/\s+$/, ''); m.after(' '); }
    }
    return norm(inlineFromNode(c));
  }
  const readField = (el: HTMLElement) => (kindOf(el) === 'inline' ? readInline(el) : norm((el.textContent || '').replace(/\n/g, ' ')));

  function render(el: HTMLElement) {
    const k = el.getAttribute('data-edit');
    const hk = el.getAttribute('data-edit-href');
    let missing = false;
    if (k) {
      const v = host.value(k);
      if (v === undefined) missing = host.loaded(k);
      else if (!(doc.activeElement === el && readField(el) === norm(v))) {
        if (kindOf(el) === 'inline') { const html = renderInline(v); if (el.innerHTML !== html) el.innerHTML = html; } // renderInline escapes everything it doesn't produce
        else if (el.textContent !== v) el.textContent = v;
      }
    }
    if (hk) {
      const v = host.value(hk);
      if (v === undefined) missing = missing || (!k && host.loaded(hk));
      else if (el.getAttribute('href') !== v) el.setAttribute('href', v);
    }
    el.classList.toggle('bx-missing', missing);
    paintMark(el);
  }
  function paintMark(el: HTMLElement) {
    const k = el.getAttribute('data-edit'), hk = el.getAttribute('data-edit-href');
    el.classList.toggle('bx-ch', (!!k && host.changed(k)) || (!!hk && host.changed(hk)));
  }
  function setEditable(on: boolean) {
    root.classList.toggle('bx-on', on);
    for (const el of all()) {
      const k = el.getAttribute('data-edit');
      if (!k) continue;
      const ok = on && !!parseKey(k) && host.value(k) !== undefined;
      if (ok) {
        el.contentEditable = kindOf(el) === 'plain' && supportsPlain ? 'plaintext-only' : 'true';
        el.spellcheck = true;
        el.setAttribute('role', 'textbox');
        el.setAttribute('aria-multiline', 'false');
        el.setAttribute('aria-label', kindOf(el) === 'inline' ? 'Editable text' : 'Editable text (plain)');
      } else if (el.isContentEditable || el.hasAttribute('contenteditable')) {
        el.removeAttribute('contenteditable');
        el.removeAttribute('role'); el.removeAttribute('aria-multiline'); el.removeAttribute('aria-label');
      }
    }
  }
  function refresh() {
    for (const el of all()) render(el);
    paintMailtos();
    setEditable(host.editable());
  }
  /** Repaint everything showing `keys` (other copies of the same field, markers), never the element being typed in. */
  function update(keys: Key[], except?: HTMLElement) {
    if (!keys.length) { refresh(); return; }
    const set = new Set(keys);
    if (set.has(EMAIL)) paintMailtos();
    for (const el of all()) {
      const k = el.getAttribute('data-edit'), hk = el.getAttribute('data-edit-href');
      if ((k && set.has(k)) || (hk && set.has(hk))) { if (el !== except) render(el); else paintMark(el); }
    }
  }

  function fields(): FieldInfo[] {
    const out: FieldInfo[] = [];
    for (const el of all()) {
      const k = el.getAttribute('data-edit'), hk = el.getAttribute('data-edit-href');
      if (k && parseKey(k)) out.push({ key: k, kind: kindOf(el), tag: el.nodeName.toLowerCase() });
      if (hk && parseKey(hk)) out.push({ key: hk, kind: 'href', tag: el.nodeName.toLowerCase() });
    }
    return out;
  }

  function commit(el: HTMLElement) {
    const k = el.getAttribute('data-edit');
    if (!k) return;
    const v = readField(el);
    host.set(k, v);
    update([k], el);
  }

  // ---------- selection toolbar ----------
  let savedRange: Range | null = null;
  const sel = () => win.getSelection();
  const place = (box: HTMLElement, r: DOMRect, below = false) => {
    box.hidden = false;
    const w = box.offsetWidth, hgt = box.offsetHeight;
    const vw = doc.documentElement.clientWidth;
    const coarse = win.matchMedia('(pointer: coarse)').matches;
    let top = below || coarse ? r.bottom + 8 : r.top - hgt - 8;
    if (top < 6) top = r.bottom + 8;
    let left = Math.max(8, Math.min(vw - w - 8, r.left + r.width / 2 - w / 2));
    if (box === pop) left = Math.max(8, Math.min(vw - w - 8, r.left));
    box.style.top = `${top + win.scrollY}px`;
    box.style.left = `${left + win.scrollX}px`;
  };
  function paintToolbar() {
    const s = sel();
    const f = s && s.rangeCount ? fieldOf(s.anchorNode) : null;
    if (!f || kindOf(f) !== 'inline' || s!.isCollapsed || !pop.hidden || fieldOf(s!.focusNode) !== f) { tb.hidden = true; return; }
    const r = s!.getRangeAt(0).getBoundingClientRect();
    if (!r.width && !r.height) { tb.hidden = true; return; }
    bBtn.setAttribute('aria-pressed', String(doc.queryCommandState('bold')));
    iBtn.setAttribute('aria-pressed', String(doc.queryCommandState('italic')));
    place(tb, r);
  }
  let tbRaf = 0;
  on(doc, 'selectionchange', () => { cancelAnimationFrame(tbRaf); tbRaf = win.requestAnimationFrame(paintToolbar); }, false);
  for (const b of [bBtn, iBtn, lBtn]) on(b, 'mousedown', (e) => e.preventDefault()); // keep the text selection
  on(bBtn, 'click', () => format('bold'));
  on(iBtn, 'click', () => format('italic'));
  on(lBtn, 'click', () => linkFromSelection());

  function format(cmd: 'bold' | 'italic') {
    const s = sel();
    const f = s && fieldOf(s.anchorNode);
    if (!f || kindOf(f) !== 'inline') return;
    doc.execCommand('styleWithCSS', false, 'false');
    doc.execCommand(cmd);
    commit(f);
    paintToolbar();
  }

  // ---------- link popover ----------
  type Target =
    | { mode: 'href'; el: HTMLElement; key: Key } // a link whose URL is its own field
    | { mode: 'inline'; field: HTMLElement; a: HTMLAnchorElement } // a link inside inline text
    | { mode: 'create'; field: HTMLElement; range: Range }; // turn the selection into a link
  let target: Target | null = null;

  function showPop(t: Target, focus: boolean) {
    target = t;
    tb.hidden = true;
    const href = t.mode === 'href' ? host.value(t.key) || '' : t.mode === 'inline' ? t.a.getAttribute('href') || '' : '';
    urlIn.value = href;
    urlIn.removeAttribute('aria-invalid');
    msg.textContent = '';
    popLabel.textContent = t.mode === 'create' ? 'Link to' : 'Link address';
    applyBtn.textContent = t.mode === 'create' ? 'Add link' : 'Apply';
    rmBtn.hidden = t.mode !== 'inline';
    const live = cleanUrl(href);
    openA.hidden = !live;
    if (live) openA.setAttribute('href', live.startsWith('/') ? new URL(live, win.location.origin).href : live);
    const anchor = t.mode === 'href' ? t.el : t.mode === 'inline' ? t.a : t.range;
    const rects = anchor.getClientRects();
    const r = rects.length ? rects[rects.length - 1] : anchor.getBoundingClientRect();
    place(pop, r as DOMRect, true);
    if (focus) { urlIn.focus(); urlIn.select(); }
  }
  function hidePop(refocus = false) {
    if (pop.hidden) return;
    pop.hidden = true;
    const t = target;
    target = null;
    if (refocus && t && t.mode !== 'href') {
      t.field.focus({ preventScroll: true });
      if (t.mode === 'create') { const s = sel(); s?.removeAllRanges(); s?.addRange(t.range); }
    }
  }
  function apply() {
    const t = target;
    if (!t) return;
    const url = cleanUrl(urlIn.value);
    if (!url) {
      urlIn.setAttribute('aria-invalid', 'true');
      msg.textContent = urlIn.value.trim() ? 'Use a web address (https://…), an email, or a /path on this site.' : 'Type an address, or remove the link.';
      return;
    }
    if (t.mode === 'href') {
      host.set(t.key, url);
      t.el.setAttribute('href', url);
      update([t.key]);
      hidePop();
      return;
    }
    if (t.mode === 'inline') {
      t.a.setAttribute('href', url);
      commit(t.field);
      hidePop(true);
      return;
    }
    // create: wrap the remembered selection (or insert the address itself as the text)
    t.field.focus({ preventScroll: true });
    const s = sel()!;
    s.removeAllRanges(); s.addRange(t.range);
    if (t.range.collapsed) doc.execCommand('insertHTML', false, `<a href="${esc(url)}">${esc(url.replace(/^mailto:/, ''))}</a>`);
    else doc.execCommand('createLink', false, url);
    target = null;
    pop.hidden = true;
    commit(t.field);
  }
  function removeLink() {
    const t = target;
    if (!t || t.mode !== 'inline') return;
    t.a.replaceWith(...t.a.childNodes);
    commit(t.field);
    hidePop(true);
  }
  function linkFromSelection() {
    const s = sel();
    const f = s && s.rangeCount ? fieldOf(s.anchorNode) : null;
    if (!f) return;
    if (kindOf(f) !== 'inline') {
      const hk = f.getAttribute('data-edit-href');
      if (hk && host.value(hk) !== undefined) showPop({ mode: 'href', el: f, key: hk }, true);
      return;
    }
    const a = (isEl(s!.anchorNode) ? s!.anchorNode : s!.anchorNode?.parentElement)?.closest('a') as HTMLAnchorElement | null;
    if (a && f.contains(a)) { showPop({ mode: 'inline', field: f, a }, true); return; }
    showPop({ mode: 'create', field: f, range: s!.getRangeAt(0).cloneRange() }, true);
  }
  on(applyBtn, 'click', apply);
  on(rmBtn, 'click', removeLink);
  on(urlIn, 'input', () => { urlIn.removeAttribute('aria-invalid'); msg.textContent = ''; });
  on(urlIn, 'keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); apply(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hidePop(true); }
  });
  on(pop, 'keydown', (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); hidePop(true); } });

  // ---------- events in the page ----------
  const inLayer = (e: Event) => e.composedPath().includes(uiHost);
  on(doc, 'click', (e: MouseEvent) => {
    if (inLayer(e)) return;
    const t = e.target as Element;
    const a = isEl(t) ? (t.closest('a, area') as HTMLElement | null) : null;
    if (a) e.preventDefault(); // never navigate away while editing
    if (!host.editable()) { if (a) host.message('Links don’t open here. Use the page tabs above to switch pages.'); return; }
    const hrefEl = isEl(t) ? (t.closest('[data-edit-href]') as HTMLElement | null) : null;
    const field = fieldOf(t);
    if (hrefEl && !hrefEl.classList.contains('bx-missing') && (!field || field === hrefEl)) {
      const key = hrefEl.getAttribute('data-edit-href')!;
      if (host.value(key) !== undefined) { showPop({ mode: 'href', el: hrefEl, key }, !hrefEl.isContentEditable); return; }
    }
    if (a && field && kindOf(field) === 'inline' && field.contains(a) && field !== a) {
      showPop({ mode: 'inline', field, a: a as HTMLAnchorElement }, false);
      return;
    }
    if (!pop.hidden) hidePop();
    if (a && !field) host.message('Links don’t open while you edit. Use the page tabs above to switch pages.');
  });
  on(doc, 'auxclick', (e: MouseEvent) => { if (isEl(e.target) && (e.target as Element).closest('a')) e.preventDefault(); });
  on(doc, 'submit', (e: Event) => e.preventDefault());
  on(doc, 'dragstart', (e: DragEvent) => { if (!inLayer(e)) e.preventDefault(); });
  on(doc, 'drop', (e: DragEvent) => { if (!inLayer(e)) e.preventDefault(); });
  on(doc, 'pointerdown', (e: PointerEvent) => { if (!inLayer(e) && !pop.hidden) { const t = e.target as Element; if (!(target && target.mode === 'href' && target.el.contains(t))) hidePop(); } });

  on(doc, 'focusin', (e: FocusEvent) => {
    const f = fieldOf(e.target as Node);
    if (f && f === e.target) host.beginEdit(f.getAttribute('data-edit')!);
  });
  on(doc, 'focusout', (e: FocusEvent) => {
    const f = fieldOf(e.target as Node);
    if (!f || f !== e.target) return;
    if (e.relatedTarget === uiHost) return; // into the toolbar / link box: still editing this field
    host.endEdit();
    // tidy the markup the browser left behind (e.g. spans from ⌘B in a bold heading), once typing is done
    const k = f.getAttribute('data-edit')!;
    const v = host.value(k);
    if (v !== undefined) {
      const want = kindOf(f) === 'inline' ? renderInline(v) : null;
      if (want !== null ? f.innerHTML !== want : f.childElementCount > 0) render(f);
    }
    setTimeout(() => { if (doc.activeElement !== uiHost && !fieldOf(doc.activeElement)) tb.hidden = true; }, 0);
  });
  on(doc, 'beforeinput', (e: InputEvent) => {
    const f = fieldOf(e.target as Node);
    if (!f) return;
    const plain = kindOf(f) === 'plain';
    if (BLOCKED_INPUT.test(e.inputType) || (plain && e.inputType.startsWith('format'))) e.preventDefault();
  });
  on(doc, 'input', (e: Event) => {
    if (inLayer(e)) return;
    const f = fieldOf(e.target as Node);
    if (f) commit(f);
  });
  on(doc, 'paste', (e: ClipboardEvent) => {
    if (inLayer(e)) return;
    const f = fieldOf(e.target as Node);
    if (!f) return;
    e.preventDefault();
    const cd = e.clipboardData;
    const text = (cd?.getData('text/plain') || '').replace(/\s*[\r\n]+\s*/g, ' ');
    const html = cd?.getData('text/html') || '';
    if (kindOf(f) === 'inline') {
      const url = cleanUrl(text);
      const s = sel();
      if (url && /^(https?:|mailto:)/i.test(text.trim()) && s && !s.isCollapsed) { doc.execCommand('createLink', false, url); commit(f); return; }
      if (html) { doc.execCommand('insertHTML', false, pasteHtml(html)); commit(f); return; }
    }
    doc.execCommand('insertText', false, text);
  });
  on(doc, 'keydown', (e: KeyboardEvent) => {
    if (inLayer(e)) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    const f = fieldOf(e.target as Node);
    if (mod && !e.altKey && k === 's') { e.preventDefault(); host.command('save'); return; }
    if (!f) {
      if (mod && !e.altKey && k === 'z' && !e.shiftKey) { e.preventDefault(); host.command('undo'); }
      if (e.key === 'Escape') hidePop();
      return;
    }
    const inline = kindOf(f) === 'inline';
    if (e.key === 'Enter') { e.preventDefault(); f.blur(); return; }
    if (e.key === 'Escape') { e.preventDefault(); if (!pop.hidden) hidePop(true); else f.blur(); return; }
    if (!mod || e.altKey) return;
    if (k === 'b' || k === 'i') { e.preventDefault(); if (inline) format(k === 'b' ? 'bold' : 'italic'); return; }
    if (k === 'k') { e.preventDefault(); linkFromSelection(); return; }
    if (k === 'u' || k === 'e' || k === 'j') e.preventDefault();
  });
  on(win, 'resize', () => { tb.hidden = true; hidePop(); }, false);

  /** Pasted HTML → only text and safe links, every bit escaped. */
  function pasteHtml(html: string): string {
    const d = new DOMParser().parseFromString(html, 'text/html');
    let out = '';
    const walk = (n: Node) => {
      if (n.nodeType === 3) { out += esc((n.textContent || '').replace(/\s+/g, ' ')); return; }
      if (n.nodeType !== 1) return;
      const e = n as Element, t = e.nodeName;
      if (t === 'SCRIPT' || t === 'STYLE' || t === 'TEMPLATE') return;
      if (t === 'BR') { out += ' '; return; }
      const url = t === 'A' ? cleanUrl(e.getAttribute('href') || '') : null;
      if (url && e.textContent?.trim()) { out += `<a href="${esc(url)}">${esc(e.textContent.replace(/\s+/g, ' '))}</a>`; return; }
      e.childNodes.forEach(walk);
      if (/^(P|DIV|LI|H[1-6]|TR|BLOCKQUOTE)$/.test(t)) out += ' ';
    };
    d.body.childNodes.forEach(walk);
    return out.replace(/\s+$/, '');
  }

  function focusKey(k: Key): boolean {
    const el = all().find((x) => x.getAttribute('data-edit') === k || x.getAttribute('data-edit-href') === k);
    if (!el) return false;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.remove('bx-flash'); void el.offsetWidth; el.classList.add('bx-flash');
    setTimeout(() => el.classList.remove('bx-flash'), 1200);
    if (el.getAttribute('data-edit') === k && el.isContentEditable) {
      el.focus({ preventScroll: true });
      const r = doc.createRange(); r.selectNodeContents(el); r.collapse(false);
      const s = sel(); s?.removeAllRanges(); s?.addRange(r);
    } else if (el.getAttribute('data-edit-href') === k) setTimeout(() => showPop({ mode: 'href', el, key: k }, true), 350);
    return true;
  }
  /** After an app-level undo: the field being typed in starts a new undo step. */
  function refocusSession() { const f = fieldOf(doc.activeElement); if (f) host.beginEdit(f.getAttribute('data-edit')!); }

  refresh();
  return {
    refresh, update, fields, focusKey, refocusSession,
    blur() { (doc.activeElement as HTMLElement | null)?.blur?.(); hidePop(); tb.hidden = true; },
    destroy() { ac.abort(); style.remove(); uiHost.remove(); root.classList.remove('bx-on'); },
  };
}
