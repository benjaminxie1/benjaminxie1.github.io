// Keeps the lists in the edited page (the iframe) in step with the state: every
// [data-edit-list] shows exactly the items of its array, in order. Items keep their
// element across moves (tagged data-bx-id = the item's id in the state); removed ones
// wait in a graveyard so undo brings back the very same element; new ones are copied
// from the item they duplicate or made from the list's <template data-edit-template>.
// After every pass each item's pointers (and everything inside it, nested lists and
// templates included) are renumbered to its new index.
import { parseKey, type Key } from './pointer';

export const MARKERS = ['data-edit', 'data-edit-href', 'data-edit-img', 'data-edit-alt', 'data-edit-optional', 'data-edit-item', 'data-edit-list', 'data-edit-template',
  'data-edit-attr', 'data-edit-class', 'data-edit-style', 'data-edit-icon', 'data-edit-sitelink'];
const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PH = /^__[a-z]__$/;

export type StructureHost = {
  idsOf(listKey: Key): string[] | undefined;
  cloneOf: Map<string, string>;
};

const isEl = (n: Node | null | undefined): n is HTMLElement => !!n && n.nodeType === 1;
const parentItem = (el: Element) => el.parentElement?.closest('[data-edit-item]') ?? null;
/** "experience:/jobs/2" → the same key with segments; keys compare token by token. */
const segs = (k: string) => k.split('/');

export function attachStructure(doc: Document, host: StructureHost) {
  const grave = new Map<string, HTMLElement>();
  const seps = new WeakMap<Element, Node[]>();

  const itemsOf = (list: Element) => [...list.children].filter((c) => c.hasAttribute('data-edit-item')) as HTMLElement[];
  const listsIn = (item: Element) => [...item.querySelectorAll('[data-edit-list]')].filter((l) => parentItem(l) === item || (l === item));
  const topLists = () => [...doc.querySelectorAll('[data-edit-list]')].filter((l) => !parentItem(l));

  function each(root: Element | DocumentFragment, fn: (el: Element) => void) {
    if (isEl(root as Node)) fn(root as Element);
    root.querySelectorAll('*').forEach((el) => {
      fn(el);
      if (el.localName === 'template') each((el as HTMLTemplateElement).content, fn);
    });
    if (isEl(root as Node) && (root as Element).localName === 'template') each((root as HTMLTemplateElement).content, fn);
  }
  /** Rewrite pointers that start with `from` to start with `to` (exact segment match). */
  function rekey(root: Element | DocumentFragment, from: string, to: string) {
    if (from === to) return;
    // a key at the start of the value or after = | ! or a space ("href=site:/nav/2/href"), ending at / | space or the end
    const re = new RegExp(`(^|[=|!\\s])${reEsc(from)}(?=[/|\\s]|$)`, 'g');
    each(root, (el) => {
      for (const a of MARKERS) {
        const v = el.getAttribute(a);
        if (v && v.includes(from)) { const n = v.replace(re, (_m, pre) => pre + to); if (n !== v) el.setAttribute(a, n); }
      }
    });
  }
  function subst(root: Element | DocumentFragment, map: Record<string, string>) {
    each(root, (el) => {
      for (const a of MARKERS) {
        const v = el.getAttribute(a);
        if (v && v.includes('__')) el.setAttribute(a, v.replace(/__[a-z]__/g, (m) => map[m] ?? m));
      }
    });
  }

  // ---------- templates ----------
  function findTemplate(listKey: Key) {
    const want = segs(listKey);
    let best: { tpl: HTMLTemplateElement; bind: Record<string, string>; holes: number } | null = null;
    for (const tpl of doc.querySelectorAll<HTMLTemplateElement>('template[data-edit-template]')) {
      const t = segs(tpl.getAttribute('data-edit-template')!);
      if (t.length !== want.length) continue;
      const bind: Record<string, string> = {};
      let ok = true, holes = 0;
      for (let i = 0; i < t.length && ok; i++) {
        if (t[i] === want[i]) continue;
        if (PH.test(t[i]) && /^\d+$/.test(want[i]) && (bind[t[i]] ?? want[i]) === want[i]) { bind[t[i]] = want[i]; holes++; }
        else ok = false;
      }
      if (ok && (!best || holes < best.holes)) best = { tpl, bind, holes };
    }
    if (!best) return null;
    // the placeholder that stands for the new item's index: whatever follows the list pointer
    const T = best.tpl.getAttribute('data-edit-template')!;
    let item = '';
    each(best.tpl.content, (el) => {
      if (item) return;
      for (const a of MARKERS) { const v = el.getAttribute(a); const m = v?.startsWith(T + '/') ? /^__[a-z]__/.exec(v.slice(T.length + 1)) : null; if (m) { item = m[0]; break; } }
    });
    return { ...best, item };
  }
  function instantiate(listKey: Key, index: number): HTMLElement | null {
    const t = findTemplate(listKey);
    if (!t) return null;
    const frag = doc.importNode(t.tpl.content, true);
    const el = (frag.querySelector('[data-edit-item]') || frag.firstElementChild) as HTMLElement | null;
    if (!el) return null;
    subst(el, { ...t.bind, ...(t.item ? { [t.item]: String(index) } : {}) });
    return el;
  }

  // ---------- items ----------
  const find = (id: string) => doc.querySelector<HTMLElement>(`[data-bx-id="${CSS.escape(id)}"]`) || grave.get(id) || null;
  function create(listKey: Key, id: string, index: number): HTMLElement | null {
    let el: HTMLElement | null = null;
    for (let src = host.cloneOf.get(id), n = 0; src && n < 20 && !el; src = host.cloneOf.get(src), n++) {
      const from = find(src);
      if (from) {
        el = from.cloneNode(true) as HTMLElement;
        el.querySelectorAll('[contenteditable]').forEach((x) => x.removeAttribute('contenteditable'));
        el.classList.remove('bx-sel', 'bx-hov', 'bx-lift');
        rekey(el, from.getAttribute('data-edit-item')!, `${listKey}/${index}`);
      }
    }
    el ||= instantiate(listKey, index);
    if (!el) return null;
    el.setAttribute('data-bx-id', id);
    retag(el);
    return el;
  }
  /** A new element's nested items take the new item's nested ids, by position. */
  function retag(el: Element) {
    for (const inner of listsIn(el)) {
      const ids = host.idsOf(inner.getAttribute('data-edit-list')!) || [];
      itemsOf(inner).forEach((it, i) => { if (ids[i]) it.setAttribute('data-bx-id', ids[i]); else it.removeAttribute('data-bx-id'); retag(it); });
    }
  }
  /** Tag the page's items with their repo ids (the page was built from the repo copy). */
  function tagAll() {
    doc.querySelectorAll('[data-edit-item]').forEach((el) => {
      if (el.hasAttribute('data-bx-id')) return;
      const p = parseKey(el.getAttribute('data-edit-item'));
      if (p) el.setAttribute('data-bx-id', p.ptr);
    });
  }

  function caret(): (() => void) | null {
    const a = doc.activeElement as HTMLElement | null;
    if (!a || a === doc.body || !a.isContentEditable) return null;
    const s = doc.getSelection();
    let off = -1;
    if (s && s.rangeCount && a.contains(s.anchorNode)) { const r = doc.createRange(); r.selectNodeContents(a); r.setEnd(s.anchorNode!, s.anchorOffset); off = r.toString().length; }
    return () => {
      if (!a.isConnected || doc.activeElement === a) return;
      a.focus({ preventScroll: true });
      if (off < 0) return;
      const w = doc.createTreeWalker(a, 4);
      let left = off, n: Node | null;
      while ((n = w.nextNode())) {
        const len = n.textContent!.length;
        if (left <= len) { const r = doc.createRange(); r.setStart(n, left); r.collapse(true); s!.removeAllRanges(); s!.addRange(r); return; }
        left -= len;
      }
    };
  }

  function reconcile(list: Element, restores: (() => void)[]) {
    const key = list.getAttribute('data-edit-list');
    const ids = key ? host.idsOf(key) : undefined;
    if (!key || !ids) return;
    const items = itemsOf(list);
    if (items.length >= 2 && !seps.has(list)) {
      const kids = [...list.childNodes];
      seps.set(list, kids.slice(kids.indexOf(items[0]) + 1, kids.indexOf(items[1])));
    }
    const byId = new Map<string, HTMLElement>();
    for (const el of items) { const id = el.getAttribute('data-bx-id'); if (id && !byId.has(id)) byId.set(id, el); }
    const want: HTMLElement[] = [];
    ids.forEach((id, n) => {
      let el = byId.get(id) || grave.get(id) || null;
      if (el && want.includes(el)) el = null;
      el ||= create(key, id, n);
      if (el) { grave.delete(id); want.push(el); }
    });
    // renumber first: moving a focused field blurs it, and the layer then repaints it from its pointer
    want.forEach((el, n) => { const cur = el.getAttribute('data-edit-item')!; const to = `${key}/${n}`; if (cur !== to) rekey(el, cur, to); });
    const same = want.length === items.length && want.every((el, i) => el === items[i]);
    if (!same) {
      const r = caret(); if (r) restores.push(r);
      for (const el of items) if (!want.includes(el)) { const id = el.getAttribute('data-bx-id'); el.remove(); if (id) grave.set(id, el); }
      const kids = [...list.childNodes];
      const first = items.length ? kids.indexOf(items[0]) : kids.length;
      const last = items.length ? kids.indexOf(items[items.length - 1]) : kids.length - 1;
      const lead = kids.slice(0, first), tail = kids.slice(last + 1);
      const sep = seps.get(list) || [];
      const out: Node[] = [...lead];
      want.forEach((el, i) => { if (i) out.push(...sep.map((s) => s.cloneNode(true))); out.push(el); });
      out.push(...tail);
      list.replaceChildren(...out);
    }
    for (const el of want) for (const inner of listsIn(el)) if (inner !== list) reconcile(inner, restores);
  }
  function reconcileAll() {
    const restores: (() => void)[] = [];
    for (const l of topLists()) reconcile(l, restores);
    restores.forEach((r) => r());
  }

  tagAll();
  return {
    reconcile: reconcileAll,
    /** The list element(s) showing listKey. */
    lists: (listKey: Key) => [...doc.querySelectorAll(`[data-edit-list="${CSS.escape(listKey)}"]`)] as HTMLElement[],
    items: itemsOf,
    /** Whether a template exists for new items of listKey. */
    canAdd: (listKey: Key) => !!findTemplate(listKey),
  };
}
export type Structure = ReturnType<typeof attachStructure>;
