// The Details panel (right drawer on desktop, bottom sheet on phones): every schema field of
// the selected item, or of the page's files, as a form. Edits go straight into the state, so
// the page preview and the in-page fields follow as you type, and page edits show up here.
import { h, id as uid } from '../ui/dom';
import { cleanUrl } from './layer';
import { norm, type SiteState, type ChangeEvent } from './state';
import { getPtr, join, split, isIndex, keyOf, parseKey, type Key } from './pointer';
import { fieldAt, rootField, fileLabel, summary, crumbs, onValue, newItemFor, plainText, type Field, type ListField, type ObjectField } from './fields';
import type { Images } from './images';

export type InspectorHost = {
  st: SiteState;
  images: Images;
  pageFiles(): string[];
  select(k: Key | null): void;
  showInPage(k: Key): void;
  removeItem(k: Key): void;
  addItem(listKey: Key): Key | null;
  editable(): boolean;
  issues(): { key: Key; message: string }[];
  closed(): void;
};

type Ctl = { key: Key; sync(issues: Map<Key, string>): void };
const scalar = (f: Field) => f.type !== 'list' && f.type !== 'object' && f.type !== 'image';
const simpleItem = (f: Field) => f.type !== 'object' ? f.type !== 'list' : Object.values(f.fields).every(scalar);
const SVG = (d: string, s = 16) => { const t = document.createElement('template'); t.innerHTML = `<svg viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true" class="ico"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`; return t.content.firstChild as SVGElement; };
const I = {
  up: 'M12 19V5M6 11l6-6 6 6', down: 'M12 5v14M6 13l6 6 6-6', dup: 'M9 9h10v10H9zM5 15V5h10', del: 'M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12',
  close: 'M6 6l12 12M18 6L6 18', next: 'M9 6l6 6-6 6', plus: 'M12 5v14M5 12h14', back: 'M15 6l-6 6 6 6',
};

export function createInspector(panel: HTMLElement, host: InspectorHost) {
  const { st } = host;
  let target: { file: string; id: string | null } | null = null; // id null = the page's files
  let open = false;
  let ctls: Ctl[] = [];

  const crumbsEl = h('nav', { class: 'sp-crumbs', 'aria-label': 'Where this is' });
  const title = h('h2', { class: 'sp-title', id: uid('sp-t') });
  const acts = h('div', { class: 'sp-acts' });
  const closeB = h('button', { type: 'button', class: 'sp-icon sp-close', 'aria-label': 'Close details', title: 'Close (Esc)' }, SVG(I.close, 18));
  const body = h('div', { class: 'sp-body' });
  panel.setAttribute('aria-labelledby', title.id);
  panel.append(h('div', { class: 'sp-grab', 'aria-hidden': 'true' }), h('div', { class: 'sp-head' }, h('div', { class: 'sp-headtop' }, crumbsEl, closeB), title, acts), body);
  closeB.addEventListener('click', () => close());

  const itemKey = (): Key | null => (target?.id ? st.keyOfId(target.file, target.id) : null);
  const issuesMap = () => new Map(host.issues().map((i) => [i.key, i.message] as const));

  // ---------- controls ----------
  const lab = (text: string, forId: string, extra?: Node | null) => h('div', { class: 'sp-lab' }, h('label', { for: forId, text }), extra || null);
  const help = (f: Field): Node | string => ((f as { help?: string }).help ? h('p', { class: 'sp-help', text: (f as { help?: string }).help }) : '');
  const msgEl = () => h('p', { class: 'sp-msg', role: 'alert' });
  function showMsg(el: HTMLElement, input: HTMLElement | null, m: string | undefined) {
    el.textContent = m || '';
    if (input) { if (m) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); }
  }
  function sw(label: string, on: boolean, change: (on: boolean) => void, hint?: string) {
    const id = uid('sw');
    const cb = h('input', { type: 'checkbox', id, role: 'switch', class: 'sp-sw-in', checked: on });
    cb.addEventListener('change', () => change(cb.checked));
    return { el: h('label', { class: 'sp-sw', for: id, title: hint || label }, cb, h('span', { class: 'sp-sw-track', 'aria-hidden': 'true' }), h('span', { class: 'sp-sw-text', text: label })), cb };
  }

  function textField(file: string, ptr: string, f: Extract<Field, { type: 'plain' | 'inline' | 'url' }>, wrap: HTMLElement) {
    const key = keyOf(file, ptr);
    const id = uid('f');
    const long = f.type === 'inline' || ((st.get(key) as string | undefined)?.length ?? 0) > 60;
    const input = long ? h('textarea', { id, class: 'sp-in', rows: 2, spellcheck: 'true', 'data-key': key }) : h('input', { id, class: 'sp-in', type: 'text', spellcheck: f.type === 'url' ? 'false' : 'true', 'data-key': key });
    if (f.type === 'url') { input.setAttribute('inputmode', 'url'); input.setAttribute('autocapitalize', 'off'); input.setAttribute('autocomplete', 'off'); }
    const ph = (f as { placeholder?: string }).placeholder;
    if (ph) input.setAttribute('placeholder', ph);
    const m = msgEl();
    const grow = () => { if (input.localName === 'textarea') { input.style.height = 'auto'; input.style.height = `${Math.min(220, input.scrollHeight + 2)}px`; } };
    input.addEventListener('input', () => { st.set(key, (input as HTMLInputElement).value, { typing: true, source: 'panel' }); grow(); });
    input.addEventListener('change', () => {
      const v = (input as HTMLInputElement).value;
      if (f.type === 'url') { const u = cleanUrl(v); if (u && u !== v) st.set(key, u, { typing: true, source: 'panel' }); }
      else if (norm(v) !== v) st.set(key, norm(v), { typing: true, source: 'panel' });
    });
    wrap.append(lab(f.label, id), input, m, help(f));
    ctls.push({ key, sync(iss) {
      const v = st.get(key);
      if (document.activeElement !== input && (input as HTMLInputElement).value !== (v ?? '')) { (input as HTMLInputElement).value = typeof v === 'string' ? v : ''; grow(); }
      showMsg(m, input, iss.get(key));
    } });
    requestAnimationFrame(grow);
  }
  function numberField(file: string, ptr: string, f: Extract<Field, { type: 'number' }>, wrap: HTMLElement) {
    const key = keyOf(file, ptr);
    const id = uid('f');
    const num = h('input', { id, class: 'sp-in sp-num', type: 'number', inputmode: 'numeric', 'data-key': key, min: f.min, max: f.max, step: f.step ?? 1 });
    const range = f.min != null && f.max != null ? h('input', { type: 'range', class: 'sp-range', min: f.min, max: f.max, step: f.step ?? 1, 'aria-label': f.label, 'data-key': key, 'data-role': 'range' }) : null;
    const m = msgEl();
    const put = (raw: string) => { const n = Number(raw); if (raw.trim() !== '' && Number.isFinite(n)) st.set(key, n, { typing: true, source: 'panel' }); };
    num.addEventListener('input', () => put(num.value));
    range?.addEventListener('input', () => put(range.value));
    wrap.append(lab(f.label, id), h('div', { class: 'sp-numrow' }, range, num), m, help(f));
    ctls.push({ key, sync(iss) {
      const v = st.get(key);
      const s = typeof v === 'number' ? String(v) : '';
      if (document.activeElement !== num && num.value !== s) num.value = s;
      if (range && document.activeElement !== range && typeof v === 'number') range.value = s;
      showMsg(m, num, iss.get(key));
    } });
  }
  function selectField(file: string, ptr: string, f: Extract<Field, { type: 'select' }>, wrap: HTMLElement) {
    const key = keyOf(file, ptr);
    const id = uid('f');
    const sel = h('select', { id, class: 'sp-in sp-sel', 'data-key': key },
      f.optional ? h('option', { value: '', text: '— None —' }) : null,
      ...f.options.map((o) => h('option', { value: o.value, text: o.label })));
    const m = msgEl();
    sel.addEventListener('change', () => st.set(key, sel.value === '' && f.optional ? undefined : sel.value, { label: 'Edit', source: 'panel-x' }));
    wrap.append(lab(f.label, id), sel, m, help(f));
    ctls.push({ key, sync(iss) {
      const v = st.get(key);
      const s = typeof v === 'string' ? v : '';
      if (sel.value !== s) sel.value = s;
      showMsg(m, sel, iss.get(key));
    } });
  }
  function boolField(file: string, ptr: string, f: Field, wrap: HTMLElement) {
    const key = keyOf(file, ptr);
    const s = sw(f.label, !!st.get(key), (on) => st.set(key, on ? true : f.optional ? undefined : false, { label: on ? `Turn on ${f.label.toLowerCase()}` : `Turn off ${f.label.toLowerCase()}`, source: 'panel-x' }));
    s.cb.setAttribute('data-key', key);
    wrap.classList.add('sp-boolrow');
    wrap.append(s.el, help(f));
    ctls.push({ key, sync() { const on = !!st.get(key); if (s.cb.checked !== on) s.cb.checked = on; } });
  }
  function imageField(file: string, ptr: string, f: Extract<Field, { type: 'image' }>, wrap: HTMLElement, label?: string) {
    const key = keyOf(file, ptr);
    const parent = split(ptr)!.parent;
    const v = st.get(key) as string | undefined;
    const has = typeof v === 'string' && !!v;
    const thumb = h('div', { class: 'sp-thumb' });
    const status = h('span', { class: 'sp-imgstate', 'aria-live': 'polite' });
    const nameFor = () => [plainText(String(crumbs(file, parent, st.get(`${file}:`)).slice(-1)[0] || 'site')), f.label].join(' ');
    const after = async (file0: File | null) => {
      if (!file0) return;
      status.textContent = 'Uploading…';
      const path = await host.images.upload(key, file0, f.dir, nameFor(), f.keepAlpha ?? true);
      status.textContent = '';
      if (path) st.set(key, path, { label: has ? 'Replace image' : 'Add image', source: 'panel-x' });
    };
    const up = h('button', { type: 'button', class: 'btn sp-btn', 'data-key': key, 'data-role': 'upload', text: has ? 'Replace…' : 'Upload…', disabled: !host.editable() });
    up.addEventListener('click', async () => after(await host.images.pick()));
    const cropB = h('button', { type: 'button', class: 'btn sp-btn', text: 'Crop…', disabled: !has || !host.editable() });
    cropB.addEventListener('click', async () => { const cur = st.get(key); if (typeof cur === 'string') after(await host.images.crop(cur, nameFor())); });
    const rm = h('button', { type: 'button', class: 'btn btn-quiet sp-btn sp-rm', text: 'Remove', disabled: !has || !f.optional, title: f.optional ? 'Remove this image' : 'This image is required. Replace it instead.' });
    rm.addEventListener('click', () => st.set(key, undefined, { label: 'Remove image', source: 'panel-x' }));
    const m = msgEl();
    wrap.append(h('div', { class: 'sp-lab' }, h('span', { class: 'sp-labtext', text: label || f.label })), h('div', { class: 'sp-img' }, thumb, h('div', { class: 'sp-imgbtns' }, up, cropB, rm, status)), m, help(f));
    ctls.push({ key, sync(iss) {
      const cur = st.get(key);
      const src = typeof cur === 'string' && cur ? host.images.src(cur, key) : host.images.uploading(key) ? host.images.src('', key) : '';
      const img = thumb.querySelector('img');
      if (src) { if (!img) thumb.replaceChildren(h('img', { src, alt: '' })); else if (img.getAttribute('src') !== src) img.setAttribute('src', src); }
      else if (!thumb.querySelector('.sp-noimg')) thumb.replaceChildren(h('span', { class: 'sp-noimg', text: 'No image' }));
      if (host.images.uploading(key)) status.textContent = 'Uploading…';
      showMsg(m, up, iss.get(key));
    } });
    if (f.alt) {
      const altF = fieldAt(file, join(parent, f.alt));
      if (altF && (altF.type === 'plain' || altF.type === 'inline')) { const w = h('div', { class: 'sp-field' }); textField(file, join(parent, f.alt), altF, w); wrap.append(w); }
    }
  }

  /** One field, with its optional switch. */
  function field(file: string, ptr: string, f: Field, skip: Set<string>): HTMLElement | null {
    const key = keyOf(file, ptr);
    const last = split(ptr)?.last ?? '';
    if (skip.has(last)) return null;
    const v = st.get(key);
    const present = v !== undefined;
    const wrap = h('div', { class: `sp-field sp-${f.type}`, 'data-for': key });
    if (f.type === 'boolean') { boolField(file, ptr, f, wrap); return wrap; }
    if (f.type === 'image' && f.optional) {
      // an optional image: present = has one; Upload adds it, Remove takes it away
      if (!present) {
        const up = h('button', { type: 'button', class: 'btn sp-btn', 'data-key': key, 'data-role': 'upload', disabled: !host.editable() }, SVG(I.plus, 14), `Add ${f.label.toLowerCase()}…`);
        up.addEventListener('click', async () => {
          const file0 = await host.images.pick();
          if (!file0) return;
          up.textContent = 'Uploading…'; up.disabled = true;
          const path = await host.images.upload(key, file0, f.dir, `${f.label}`, f.keepAlpha ?? true);
          if (path) st.set(key, path, { label: 'Add image', source: 'panel-x' });
          else { up.disabled = false; up.textContent = `Add ${f.label.toLowerCase()}…`; }
        });
        wrap.append(h('div', { class: 'sp-lab' }, h('span', { class: 'sp-labtext', text: f.label }), h('span', { class: 'sp-off', text: 'Not shown' })), up, help(f));
        return wrap;
      }
      imageField(file, ptr, f, wrap);
      return wrap;
    }
    if (f.optional && f.type !== 'list') {
      const s = sw(present ? 'Shown' : 'Hidden', present, (on) => st.set(key, on ? onValue(file, ptr) : undefined, { label: on ? `Show ${f.label.toLowerCase()}` : `Hide ${f.label.toLowerCase()}`, source: 'panel-x' }), `Show ${f.label.toLowerCase()} on the page`);
      s.cb.setAttribute('data-key', key); s.cb.setAttribute('data-role', 'toggle');
      s.cb.setAttribute('aria-label', `Show ${f.label}`);
      if (!present) {
        wrap.classList.add('is-off');
        wrap.append(h('div', { class: 'sp-lab' }, h('span', { class: 'sp-labtext', text: f.label }), s.el), help(f));
        return wrap;
      }
      wrap.append(h('div', { class: 'sp-optbar' }, s.el));
    }
    switch (f.type) {
      case 'plain': case 'inline': case 'url': textField(file, ptr, f, wrap); break;
      case 'number': numberField(file, ptr, f, wrap); break;
      case 'select': selectField(file, ptr, f, wrap); break;
      case 'image': imageField(file, ptr, f, wrap); break;
      case 'object': {
        const opt = wrap.querySelector('.sp-optbar');
        const fs = h('fieldset', { class: 'sp-group' }, h('legend', { text: f.label }));
        if (opt) { fs.append(opt); }
        objectFields(file, ptr, f, fs);
        wrap.append(fs, help(f));
        break;
      }
      case 'list': listField(file, ptr, f, wrap); break;
    }
    // the on/off switch sits in the field's label row
    const bar = wrap.querySelector(':scope > .sp-optbar');
    const lab0 = wrap.querySelector(':scope > .sp-lab');
    if (bar && lab0) { lab0.append(...bar.childNodes); bar.remove(); }
    return wrap;
  }
  function objectFields(file: string, ptr: string, f: ObjectField, into: HTMLElement) {
    const skip = new Set<string>();
    for (const sf of Object.values(f.fields)) if (sf.type === 'image' && sf.alt) skip.add(sf.alt);
    for (const [k, sf] of Object.entries(f.fields)) { const el = field(file, join(ptr, k), sf, skip); if (el) into.append(el); }
  }

  function rowActs(file: string, L: string, i: number, n: number, f: ListField, label: string) {
    const LK = keyOf(file, L), key = keyOf(file, join(L, i));
    const b = (icon: string, aria: string, dis: boolean, run: () => void, why?: string, cls = '') => {
      const x = h('button', { type: 'button', class: `sp-icon ${cls}`, 'aria-label': aria, title: dis && why ? why : aria, disabled: dis || !host.editable() }, SVG(icon));
      x.addEventListener('click', run);
      return x;
    };
    return h('span', { class: 'sp-rowacts' },
      b(I.up, `Move ${label} up`, i === 0, () => st.move(LK, i, i - 1)),
      b(I.down, `Move ${label} down`, i >= n - 1, () => st.move(LK, i, i + 1)),
      b(I.dup, `Duplicate ${label}`, n >= (f.max ?? Infinity), () => st.duplicate(key), `At most ${f.max}`),
      b(I.del, `Delete ${label}`, n <= (f.min ?? 0), () => host.removeItem(key), `Keep at least ${f.min}`, 'sp-del'));
  }
  function listField(file: string, ptr: string, f: ListField, wrap: HTMLElement) {
    const key = keyOf(file, ptr);
    const arr = st.get(key);
    const items = Array.isArray(arr) ? arr : [];
    const n = items.length;
    const m = msgEl();
    const head = h('div', { class: 'sp-listhead' }, h('span', { class: 'sp-labtext', text: f.label }), h('span', { class: 'sp-count', text: `${n}${f.max ? ` / ${f.max}` : ''}` }));
    const ul = h('ol', { class: 'sp-rows', 'aria-label': f.label });
    const simple = simpleItem(f.item);
    items.forEach((v, i) => {
      const ip = join(ptr, i), ik = keyOf(file, ip);
      const name = summary(file, ptr, i, v);
      const li = h('li', { class: `sp-row${simple ? ' is-simple' : ''}`, 'data-item': ik, tabindex: '-1' });
      const top = h('div', { class: 'sp-rowtop' });
      if (simple) top.append(h('span', { class: 'sp-rowname', text: name }));
      else {
        const go = h('button', { type: 'button', class: 'sp-rowgo', 'data-key': ik, 'data-role': 'go' }, h('span', { class: 'sp-rowname', text: name }), SVG(I.next, 15));
        go.addEventListener('click', () => openItem(ik));
        top.append(go);
      }
      top.append(rowActs(file, ptr, i, n, f, f.itemLabel));
      li.append(top);
      if (simple) {
        const box = h('div', { class: 'sp-rowfields' });
        if (f.item.type === 'object') objectFields(file, ip, f.item, box);
        else { const el = field(file, ip, f.item, new Set()); if (el) box.append(el); }
        li.append(box);
      }
      li.addEventListener('keydown', (e) => {
        if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
        e.preventDefault();
        const to = i + (e.key === 'ArrowUp' ? -1 : 1);
        if (to >= 0 && to < n) { refocus = { key: keyOf(file, join(ptr, to)), role: 'row' }; st.move(key, i, to); }
      });
      ul.append(li);
    });
    const add = h('button', { type: 'button', class: 'btn sp-add', 'data-key': key, 'data-role': 'add', disabled: n >= (f.max ?? Infinity) || !host.editable(), title: n >= (f.max ?? Infinity) ? `At most ${f.max} ${f.itemLabel}s` : '' }, SVG(I.plus, 14), `Add ${f.itemLabel}`);
    add.addEventListener('click', () => {
      const k = host.addItem(key);
      if (k) refocus = { key: k, role: 'first' };
    });
    wrap.append(head, help(f), n ? ul : h('p', { class: 'sp-empty', text: `No ${f.itemLabel}s yet.` }), add, m);
    ctls.push({ key, sync(iss) { showMsg(m, null, iss.get(key)); } });
  }

  // ---------- views ----------
  let refocus: { key: Key; role: string } | null = null;
  function render() {
    if (!open) return;
    const active = document.activeElement as HTMLElement | null;
    const keep = active && panel.contains(active) ? { key: active.getAttribute('data-key') || active.closest('[data-item]')?.getAttribute('data-item') || '', role: active.getAttribute('data-role') || (active.closest('[data-item]') === active ? 'row' : ''), s: (active as HTMLInputElement).selectionStart, e: (active as HTMLInputElement).selectionEnd } : null;
    const scroll = body.scrollTop;
    ctls = [];
    body.replaceChildren();
    crumbsEl.replaceChildren();
    acts.replaceChildren();
    const ik = itemKey();
    if (target?.id && !ik) target = null; // the item is gone (deleted, undone)
    if (!target || !ik) renderPage(); else renderItem(ik);
    sync();
    body.scrollTop = scroll;
    const want = refocus || keep;
    refocus = null;
    if (want?.key) {
      let el: HTMLElement | null = null;
      if (want.role === 'first') el = body.querySelector<HTMLElement>(`[data-item="${CSS.escape(want.key)}"] .sp-in, [data-item="${CSS.escape(want.key)}"] .sp-rowgo`) || body.querySelector(`[data-item="${CSS.escape(want.key)}"]`);
      else if (want.role === 'row') el = body.querySelector<HTMLElement>(`[data-item="${CSS.escape(want.key)}"]`);
      else el = body.querySelector<HTMLElement>(`[data-key="${CSS.escape(want.key)}"]${want.role ? `[data-role="${want.role}"]` : ':not([data-role])'}`) || body.querySelector(`[data-key="${CSS.escape(want.key)}"]`);
      if (el) {
        el.focus({ preventScroll: want === refocus });
        if (keep && 's' in want && typeof (want as typeof keep).s === 'number') try { (el as HTMLInputElement).setSelectionRange((want as typeof keep).s!, (want as typeof keep).e!); } catch {}
      }
    }
  }
  function sync() {
    const iss = issuesMap();
    for (const c of ctls) c.sync(iss);
  }
  function renderPage() {
    title.textContent = 'Page details';
    crumbsEl.append(h('span', { text: 'Everything on this page, including what isn’t visible text' }));
    for (const file of host.pageFiles()) {
      const root = rootField(file);
      if (!root) continue;
      if (!st.loaded(file)) { body.append(h('p', { class: 'sp-empty', text: `Loading ${fileLabel(file)}…` })); continue; }
      const sec = h(file === 'site' ? 'details' : 'section', { class: 'sp-sec' });
      const head = h(file === 'site' ? 'summary' : 'h3', { class: 'sp-sechead' }, fileLabel(file), h('span', { class: 'sp-path', text: ` · ${file}.json` }));
      sec.append(head);
      objectFields(file, '', root, sec);
      body.append(sec);
    }
  }
  function renderItem(ik: Key) {
    const p = parseKey(ik)!;
    const s = split(p.ptr)!;
    const data = st.get(`${p.file}:`);
    const list = fieldAt(p.file, s.parent) as ListField | null;
    const v = st.get(ik);
    const cs = crumbs(p.file, p.ptr, data);
    // breadcrumb: page › list › parent item › …
    const pageB = h('button', { type: 'button', class: 'linkish sp-crumb', text: fileLabel(p.file) });
    pageB.addEventListener('click', () => { target = null; host.select(null); render(); });
    crumbsEl.append(pageB);
    const t = p.ptr.split('/').slice(1);
    let acc = '';
    t.forEach((tok, n) => {
      acc = join(acc, tok);
      if (n === t.length - 1) return;
      const sep = h('span', { class: 'sp-sep', 'aria-hidden': 'true', text: '›' });
      if (isIndex(tok)) {
        const k = keyOf(p.file, acc);
        const b = h('button', { type: 'button', class: 'linkish sp-crumb', text: cs[n] });
        b.addEventListener('click', () => openItem(k));
        crumbsEl.append(sep, b);
      } else crumbsEl.append(sep, h('span', { class: 'sp-crumbtext', text: cs[n] }));
    });
    const i = +s.last;
    const arr = st.get(keyOf(p.file, s.parent));
    const n = Array.isArray(arr) ? arr.length : 0;
    title.textContent = summary(p.file, s.parent, i, v);
    if (list) acts.append(h('span', { class: 'sp-kind', text: `${list.itemLabel.replace(/^./, (c) => c.toUpperCase())} ${i + 1} of ${n}` }), rowActs(p.file, s.parent, i, n, list, list.itemLabel));
    const showB = h('button', { type: 'button', class: 'linkish sp-showb', text: 'Show on page' });
    showB.addEventListener('click', () => host.showInPage(ik));
    acts.append(showB);
    const item = list?.item;
    if (!item) return;
    if (item.type === 'object') objectFields(p.file, p.ptr, item, body);
    else { const el = field(p.file, p.ptr, item, new Set()); if (el) body.append(el); }
  }
  function openItem(k: Key | null, focus?: Key) {
    const p = parseKey(k);
    const id = k ? st.idOf(k) : undefined;
    target = p && id ? { file: p.file, id } : null;
    if (k) host.select(k);
    show();
    render();
    if (focus) focusKey(focus);
  }
  function focusKey(k: Key) {
    const el = body.querySelector<HTMLElement>(`[data-key="${CSS.escape(k)}"]:not([data-role="range"])`) || body.querySelector<HTMLElement>(`[data-for="${CSS.escape(k)}"]`);
    if (!el) return false;
    el.scrollIntoView({ block: 'center' });
    const box = el.closest('.sp-field') as HTMLElement | null;
    box?.classList.remove('sp-flash'); void box?.offsetWidth; box?.classList.add('sp-flash');
    el.focus({ preventScroll: true });
    return true;
  }
  function show() {
    if (open) return;
    open = true;
    panel.hidden = false;
    document.documentElement.classList.add('s-panel-open');
  }
  function close() {
    if (!open) return;
    open = false;
    panel.hidden = true;
    document.documentElement.classList.remove('s-panel-open');
    host.closed();
  }
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); close(); }
  });

  return {
    /** Show an item (or the page when k is null), optionally focusing one of its fields. */
    open: openItem,
    close,
    toggle() { if (open) close(); else openItem(itemKey()); },
    get isOpen() { return open; },
    focusKey,
    /** The selected item changed in the page: follow it while open. */
    follow(k: Key | null) {
      if (!open) return;
      const id = k ? st.idOf(k) : null;
      const p = parseKey(k);
      if ((target?.id ?? null) === (id ?? null) && (!p || target?.file === p.file)) return;
      if (!k) return; // clicking outside items keeps what's shown
      target = p && id ? { file: p.file, id } : null;
      render();
    },
    paint(e?: ChangeEvent) {
      if (!open) return;
      // typing here only syncs (the input keeps focus and caret); anything else re-renders
      if (e && (e.source === 'save' || (e.source === 'panel' && !e.structural))) { sync(); return; }
      render();
    },
    render,
  };
}
export type Inspector = ReturnType<typeof createInspector>;
