// Find & replace in the post body (⌘F). Matches are ProseMirror decorations, so the
// selection and the document are untouched until you replace something.
// Searches within each text block; text inside footnotes and atoms isn't searched.
import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { h, keyLabel } from './ui';

type Hit = { from: number; to: number };
type FindState = { query: string; caseSensitive: boolean; hits: Hit[]; cur: number; deco: DecorationSet };
const key = new PluginKey<FindState>('edFind');
const OBJ = '￼'; // one char per inline leaf (footnote, hard break): keeps index ↔ position 1:1

function search(doc: PMNode, query: string, cs: boolean): Hit[] {
  if (!query) return [];
  const q = cs ? query : query.toLocaleLowerCase();
  const out: Hit[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = node.textBetween(0, node.content.size, undefined, OBJ);
    if (!cs) text = text.toLocaleLowerCase();
    // lowercasing can change length (rare: İ); skip the block rather than mis-map positions
    if (text.length !== node.content.size) return false;
    for (let i = text.indexOf(q); i !== -1 && out.length < 5000; i = text.indexOf(q, i + Math.max(1, q.length))) {
      out.push({ from: pos + 1 + i, to: pos + 1 + i + q.length });
    }
    return false;
  });
  return out;
}

function build(doc: PMNode, hits: Hit[], cur: number) {
  return DecorationSet.create(doc, hits.map((m, i) => Decoration.inline(m.from, m.to, { class: i === cur ? 'ed-find-hit is-cur' : 'ed-find-hit' })));
}

/** Pick the first match at or after `pos`. */
const nearest = (hits: Hit[], pos: number) => { const i = hits.findIndex((m) => m.from >= pos); return i === -1 ? 0 : i; };

export const FindPlugin = Extension.create({
  name: 'edFind',
  addProseMirrorPlugins() {
    return [new Plugin<FindState>({
      key,
      state: {
        init: () => ({ query: '', caseSensitive: false, hits: [], cur: -1, deco: DecorationSet.empty }),
        apply(tr, prev, _old, state) {
          const meta = tr.getMeta(key) as Partial<FindState> & { at?: number } | undefined;
          if (!meta && !tr.docChanged) return prev;
          const query = meta?.query ?? prev.query;
          const cs = meta?.caseSensitive ?? prev.caseSensitive;
          if (!query) return { query, caseSensitive: cs, hits: [], cur: -1, deco: DecorationSet.empty };
          const hits = search(state.doc, query, cs);
          let cur: number;
          if (meta?.cur !== undefined) cur = meta.cur;
          else if (meta?.at !== undefined) cur = nearest(hits, meta.at);
          else if (prev.cur >= 0 && prev.hits[prev.cur]) cur = nearest(hits, tr.mapping.map(prev.hits[prev.cur].from));
          else cur = nearest(hits, state.selection.from);
          if (!hits.length) cur = -1; else cur = ((cur % hits.length) + hits.length) % hits.length;
          return { query, caseSensitive: cs, hits, cur, deco: build(state.doc, hits, cur) };
        },
      },
      props: { decorations: (state) => key.getState(state)?.deco },
    })];
  },
});

const getFind = (s: EditorState) => key.getState(s)!;

/** The floating find bar. One per editor. */
export function createFindBar(editor: Editor, o: { onOpen?: () => void; onClose?: () => void } = {}) {
  const input = h('input', { class: 'ed-find-in', type: 'search', placeholder: 'Find in post', 'aria-label': 'Find in post', spellcheck: 'false', autocomplete: 'off', enterkeyhint: 'search' });
  const rep = h('input', { class: 'ed-find-in', type: 'text', placeholder: 'Replace with', 'aria-label': 'Replace with', spellcheck: 'false', autocomplete: 'off' });
  const count = h('span', { class: 'ed-find-count', 'aria-live': 'polite' });
  const btn = (label: string, text: string, cls = '', tip = label) => h('button', { type: 'button', class: 'ed-find-btn ' + cls, 'aria-label': label, title: tip }, text);
  const prev = btn('Previous match', '↑', 'ico', `Previous (${keyLabel('Shift-Enter')})`);
  const next = btn('Next match', '↓', 'ico', `Next (${keyLabel('Enter')})`);
  const caseBtn = btn('Match case', 'Aa', 'case');
  caseBtn.setAttribute('aria-pressed', 'false');
  const toggleRep = btn('Show replace', 'Replace', 'txt');
  toggleRep.setAttribute('aria-expanded', 'false');
  const close = btn('Close find', '×', 'ico x', 'Close (Esc)');
  const one = btn('Replace this match', 'Replace', 'txt');
  const all = btn('Replace all matches', 'All', 'txt');
  const row2 = h('div', { class: 'ed-find-row ed-find-rep', hidden: true }, rep, one, all);
  const el = h('div', { class: 'ed-find', role: 'search', 'aria-label': 'Find and replace', hidden: true },
    h('div', { class: 'ed-find-row' }, input, count, caseBtn, prev, next, toggleRep, close),
    row2,
  );
  document.body.append(el);

  const st = () => getFind(editor.state);
  const set = (m: Partial<FindState> & { at?: number }) => editor.view.dispatch(editor.state.tr.setMeta(key, m).setMeta('addToHistory', false));

  function reveal() {
    const s = st();
    const m = s.hits[s.cur];
    if (!m) return;
    try {
      const c = editor.view.coordsAtPos(m.from);
      const top = el.getBoundingClientRect().bottom + 24, bottom = window.innerHeight - 110;
      if (c.top < top || c.bottom > bottom) window.scrollBy({ top: c.top - Math.max(top + 40, window.innerHeight * 0.4), behavior: 'auto' });
    } catch {}
  }
  function paint() {
    const s = st();
    const q = input.value;
    count.textContent = !q ? '' : s.hits.length ? `${s.cur + 1} of ${s.hits.length >= 5000 ? '5000+' : s.hits.length}` : 'No matches';
    el.classList.toggle('is-none', !!q && !s.hits.length);
    prev.disabled = next.disabled = s.hits.length < 1;
    one.disabled = all.disabled = s.hits.length < 1;
    caseBtn.setAttribute('aria-pressed', String(s.caseSensitive));
  }
  editor.on('transaction', () => { if (!el.hidden) paint(); });

  function step(d: 1 | -1) {
    const s = st();
    if (!s.hits.length) return;
    set({ cur: s.cur + d });
    reveal();
  }
  input.addEventListener('input', () => { set({ query: input.value, at: editor.state.selection.from }); reveal(); });
  caseBtn.addEventListener('click', () => { set({ caseSensitive: !st().caseSensitive, at: st().hits[st().cur]?.from ?? editor.state.selection.from }); input.focus(); });
  prev.addEventListener('click', () => step(-1));
  next.addEventListener('click', () => step(1));
  close.addEventListener('click', () => hide(true));
  toggleRep.addEventListener('click', () => showReplace(row2.hidden));

  function replaceOne() {
    const s = st();
    const m = s.hits[s.cur];
    if (!m) return;
    const tr = editor.state.tr;
    if (rep.value) tr.insertText(rep.value, m.from, m.to); else tr.delete(m.from, m.to);
    tr.setMeta(key, { at: m.from + rep.value.length });
    editor.view.dispatch(tr);
    if ((document.activeElement as HTMLButtonElement | null)?.disabled) rep.focus();
    reveal();
  }
  function replaceAll() {
    const s = st();
    if (!s.hits.length) return;
    const n = s.hits.length;
    const tr = editor.state.tr;
    for (let i = s.hits.length - 1; i >= 0; i--) {
      const m = s.hits[i];
      if (rep.value) tr.insertText(rep.value, m.from, m.to); else tr.delete(m.from, m.to);
    }
    editor.view.dispatch(tr);
    count.textContent = `Replaced ${n}`;
    rep.focus(); // the buttons just got disabled: keep focus (and Esc) in the bar
  }
  one.addEventListener('click', replaceOne);
  all.addEventListener('click', replaceAll);

  el.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hide(true); return; }
    if (e.key === 'Enter' && e.target === input) { e.preventDefault(); step(e.shiftKey ? -1 : 1); return; }
    if (e.key === 'Enter' && e.target === rep) { e.preventDefault(); if (mod) replaceAll(); else replaceOne(); return; }
    if (mod && e.key.toLowerCase() === 'g') { e.preventDefault(); step(e.shiftKey ? -1 : 1); return; }
    if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); input.focus(); input.select(); }
  });

  function showReplace(on: boolean) {
    row2.hidden = !on;
    toggleRep.setAttribute('aria-expanded', String(on));
    toggleRep.classList.toggle('on', on);
    (on ? rep : input).focus();
  }

  function show(o2: { replace?: boolean } = {}) {
    const { from, to, empty } = editor.state.selection;
    const picked = !empty ? editor.state.doc.textBetween(from, to, ' ').slice(0, 200) : '';
    const wasHidden = el.hidden;
    el.hidden = false;
    if (picked && !picked.includes('\n')) input.value = picked;
    if (o2.replace) showReplace(true); else { input.focus(); input.select(); }
    set({ query: input.value, at: from });
    if (wasHidden) o.onOpen?.();
    paint();
    reveal();
  }
  function hide(toText: boolean) {
    if (el.hidden) return;
    const s = st();
    const m = s.hits[s.cur];
    el.hidden = true;
    set({ query: '' });
    o.onClose?.();
    if (toText) {
      editor.view.focus();
      if (m) editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, m.from, m.to)).scrollIntoView());
    }
  }
  return {
    el,
    show,
    hide,
    isOpen: () => !el.hidden,
    next: () => { if (el.hidden) show(); else step(1); },
    prev: () => { if (el.hidden) show(); else step(-1); },
    destroy: () => el.remove(),
  };
}
