// Footnotes / citations: an inline atom holding the note's text (inline markdown, one line).
// In the text it shows as a small superscript number, numbered live in document order; click it
// (or select it and press Enter) to edit or remove the note. A "Notes" list under the post mirrors
// the site's footnotes section. Markdown form ([^1] … [^1]: note) lives in ../markdown-footnotes.ts.
import { Node, type Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { Marked } from 'marked';
import { Floater, h, keepFocus } from './ui';
import type { SlashItem } from './slash';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    footnote: {
      /** Insert an empty footnote after the selection and open its editor. */
      insertFootnote: () => ReturnType;
    };
  }
}

export const FOOTNOTE_KEY = 'Mod-Alt-f';
export const footnoteIcon = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 11.5h6M2.5 8h7"/><path d="M11.4 3.6h1.3v4M11 7.6h2.4"/></svg>';

type Item = { pos: number; node: PMNode; n: number };
type Group = { n: number; note: string; ref: string; items: Item[] };

/** Footnotes in document order, grouped like the site does (same label + text = one note). */
export function collectFootnotes(doc: PMNode): Group[] {
  const groups: Group[] = [];
  const byKey = new Map<string, Group>();
  doc.descendants((node, pos) => {
    if (node.type.name !== 'footnote') return;
    const note = String(node.attrs.note || ''), ref = String(node.attrs.ref || '');
    const key = ref + '\u0000' + note.replace(/\s+/g, ' ').trim();
    let g = byKey.get(key);
    if (!g) { g = { n: groups.length + 1, note, ref, items: [] }; groups.push(g); byKey.set(key, g); }
    g.items.push({ pos, node, n: g.n });
  });
  return groups;
}

// Notes render their inline markdown (italic, links…), sanitised to a few inline tags.
const inline = new Marked({ gfm: true, breaks: false });
const ALLOWED = new Set(['A', 'EM', 'STRONG', 'CODE', 'DEL', 'S', 'BR']);
export function renderNote(md: string): DocumentFragment {
  const t = document.createElement('template');
  t.innerHTML = inline.parseInline(md || '', { async: false }) as string;
  const walk = (el: ParentNode) => {
    for (const c of [...el.childNodes]) {
      if (c.nodeType === 3) continue;
      if (c.nodeType !== 1) { c.remove(); continue; }
      const e = c as HTMLElement;
      walk(e);
      if (!ALLOWED.has(e.nodeName)) { e.replaceWith(...e.childNodes); continue; }
      const href = e.nodeName === 'A' ? e.getAttribute('href') || '' : '';
      for (const a of [...e.attributes]) e.removeAttribute(a.name);
      if (href && !/^\s*(javascript|data|vbscript):/i.test(href)) { e.setAttribute('href', href); e.setAttribute('target', '_blank'); e.setAttribute('rel', 'noopener noreferrer'); }
    }
  };
  walk(t.content);
  return t.content;
}

const numKey = new PluginKey<DecorationSet>('edFootnoteNumbers');
const decorate = (doc: PMNode) =>
  DecorationSet.create(doc, collectFootnotes(doc).flatMap((g) =>
    g.items.map((it) => Decoration.node(it.pos, it.pos + it.node.nodeSize, {
      'data-n': String(g.n),
      'aria-label': `Footnote ${g.n}${g.note ? ': ' + g.note : ' (empty)'}`,
      class: g.note.trim() ? 'ed-fn' : 'ed-fn is-empty',
    }))));

const freshRef = () => 'n' + Math.random().toString(36).slice(2, 9);

/** The popover (edit / remove a note) and the live Notes list under the post. */
class FootnoteUI {
  private input = h('textarea', { class: 'ed-fn-input', rows: '2', placeholder: 'Note or citation…', 'aria-label': 'Footnote text', spellcheck: 'true' });
  private remove = h('button', { type: 'button', class: 'ed-btn ed-text-btn' }, 'Remove');
  private done = h('button', { type: 'button', class: 'ed-btn ed-text-btn ed-primary' }, 'Done');
  private title = h('span', { class: 'ed-fn-title' });
  private pop = h('div', { class: 'ed-pop ed-fn-pop', role: 'dialog', 'aria-label': 'Edit footnote' },
    h('div', { class: 'ed-fn-head' }, this.title, h('span', { class: 'ed-fn-hint', 'aria-hidden': 'true' }, '*italic* · [link](url) · ↵ done · esc')),
    this.input,
    h('div', { class: 'ed-fn-actions' }, this.remove, h('span', { class: 'ed-fn-gap' }), this.done));
  private floater = new Floater(this.pop, 'bottom', 8);
  private cur: { ref: string; note: string; fresh: boolean } | null = null;
  list = h('section', { class: 'footnotes ed-notes', 'aria-label': 'Notes', hidden: true }, h('ol'));
  private sig = '';

  constructor(private editor: Editor) {
    keepFocus(this.remove); keepFocus(this.done);
    this.done.addEventListener('click', () => this.commit(true));
    this.remove.addEventListener('click', () => this.commit(true, true));
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.commit(true); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.cancel(); }
    });
    this.input.addEventListener('input', () => this.grow());
    this.pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); this.cancel(); } });
    this.pop.addEventListener('focusout', (e) => {
      const next = e.relatedTarget as globalThis.Node | null;
      if (next && this.pop.contains(next)) return;
      setTimeout(() => { if (this.cur && !this.pop.contains(document.activeElement)) this.commit(false); }, 0);
    });
  }

  get isOpen() { return !!this.cur; }
  private grow() { this.input.style.height = 'auto'; this.input.style.height = Math.min(this.input.scrollHeight + 2, 160) + 'px'; }
  private group(ref: string, note?: string) {
    return collectFootnotes(this.editor.state.doc).find((g) => g.ref === ref && (note === undefined || g.note === note));
  }
  private refDom(pos: number) { try { return this.editor.view.nodeDOM(pos) as HTMLElement | null; } catch { return null; } }

  /** Open the editor for the footnote at `pos` (anchored to it, or to `anchor`). */
  open(pos: number, opts: { fresh?: boolean; anchor?: HTMLElement } = {}) {
    const node = this.editor.state.doc.nodeAt(pos);
    if (!node || node.type.name !== 'footnote') return;
    if (this.cur) this.commit(false);
    const ref = String(node.attrs.ref || '');
    const g = this.group(ref, String(node.attrs.note || ''));
    this.cur = { ref, note: String(node.attrs.note || ''), fresh: !!opts.fresh };
    this.title.textContent = `Footnote ${g?.n ?? ''}`;
    this.remove.hidden = !!opts.fresh && !this.cur.note;
    this.input.value = this.cur.note;
    const { state, view } = this.editor;
    view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, pos)).setMeta('edBubble', 'hide'));
    const anchor = opts.anchor;
    this.floater.show(() => {
      if (anchor?.isConnected) return anchor.getBoundingClientRect();
      const g2 = this.cur && this.group(this.cur.ref, this.cur.note);
      const el = g2 ? this.refDom(g2.items[0].pos) : null;
      return el?.getBoundingClientRect() || null;
    }, 'bottom');
    this.grow();
    this.input.focus({ preventScroll: true });
    this.input.setSelectionRange(this.input.value.length, this.input.value.length);
  }

  openByRef(ref: string, fresh = false) {
    const g = this.group(ref);
    if (g) this.open(g.items[0].pos, { fresh });
  }

  /** Apply the field (empty or Remove = delete the note everywhere it's referenced). */
  commit(refocus: boolean, removeIt = false) {
    const cur = this.cur;
    if (!cur) return;
    this.cur = null;
    this.floater.hide();
    const ed = this.editor;
    if (ed.isDestroyed) return;
    const value = this.input.value.replace(/\s+/g, ' ').trim();
    const g = this.group(cur.ref, cur.note);
    if (!g) return;
    let tr = ed.state.tr;
    let after = g.items[0].pos + 1;
    if (removeIt || !value) {
      for (const it of [...g.items].reverse()) tr = tr.delete(it.pos, it.pos + it.node.nodeSize);
      after = tr.mapping.map(g.items[0].pos);
    } else if (value !== cur.note) {
      for (const it of g.items) tr = tr.setNodeMarkup(it.pos, undefined, { ...it.node.attrs, note: value });
    }
    if (refocus) {
      tr = tr.setSelection(TextSelection.create(tr.doc, Math.min(after, tr.doc.content.size)));
      ed.view.dispatch(tr);
      ed.view.focus();
    } else if (tr.docChanged) ed.view.dispatch(tr);
  }

  cancel() {
    const cur = this.cur;
    if (!cur) return;
    // Esc on a brand-new, still-empty note takes it back out.
    if (cur.fresh && !cur.note) { this.input.value = ''; this.commit(true); return; }
    this.cur = null;
    this.floater.hide();
    const g = this.group(cur.ref, cur.note);
    const ed = this.editor;
    if (g && !ed.isDestroyed) {
      ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, g.items[0].pos + 1)));
      ed.view.focus();
    }
  }

  /** Re-draw the Notes list when the footnotes change. */
  render(state: EditorState) {
    const groups = collectFootnotes(state.doc);
    const sig = JSON.stringify(groups.map((g) => [g.ref, g.note, g.items.length]));
    const dom = this.editor.view.dom;
    if (this.list.parentNode !== dom.parentNode) dom.after(this.list);
    if (sig === this.sig) return;
    this.sig = sig;
    const ol = this.list.querySelector('ol')!;
    ol.replaceChildren(...groups.map((g) => {
      const body = h('span', { class: 'ed-note-text', role: 'button', tabindex: '0', title: 'Edit note' });
      if (g.note.trim()) body.append(renderNote(g.note)); else body.append(h('span', { class: 'ed-note-empty' }, 'Empty note'));
      const back = g.items.map((it, k) => {
        const a = h('a', { href: '#', class: 'data-footnote-backref', 'data-footnote-backref': '', 'aria-label': `Back to reference ${g.n}${k ? '-' + (k + 1) : ''}` }, '↩');
        if (k) a.append(h('sup', {}, String(k + 1)));
        a.addEventListener('click', (e) => { e.preventDefault(); this.reveal(g.ref, g.note, k); });
        return a;
      });
      const edit = (e: Event) => {
        if ((e.target as HTMLElement).closest('a')) { if (e.type === 'click') e.preventDefault(); else return; }
        const cur = this.group(g.ref, g.note);
        if (cur) this.open(cur.items[0].pos, { anchor: li });
      };
      body.addEventListener('click', edit);
      body.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); edit(e); } });
      const p = h('p', {}, body);
      for (const a of back) p.append(' ', a);
      const li = h('li', { 'data-ref': g.ref }, p);
      return li;
    }));
    this.list.hidden = groups.length === 0;
  }

  /** Back-arrow: jump to a reference in the text and select it. */
  private reveal(ref: string, note: string, k: number) {
    const g = this.group(ref, note);
    const it = g?.items[k];
    if (!it) return;
    const { state, view } = this.editor;
    view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, it.pos)));
    view.focus();
    this.refDom(it.pos)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  destroy() { this.floater.hide(); this.list.remove(); }
}

export const Footnote = Node.create<Record<string, never>, { ui: FootnoteUI | null }>({
  name: 'footnote',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,
  marks: '',
  addStorage: () => ({ ui: null }),
  addAttributes() {
    return {
      note: { default: '', parseHTML: (el) => el.getAttribute('data-footnote') || '', renderHTML: (a) => ({ 'data-footnote': a.note || '' }) },
      ref: { default: null, parseHTML: (el) => el.getAttribute('data-ref') || freshRef(), renderHTML: (a) => (a.ref ? { 'data-ref': a.ref } : {}) },
    };
  },
  parseHTML: () => [{ tag: 'sup[data-footnote]', priority: 60 }],
  renderHTML: ({ HTMLAttributes }) => ['sup', HTMLAttributes, '*'],
  renderText: () => '',
  addNodeView() {
    return () => {
      const dom = h('sup', { class: 'ed-fn', contenteditable: 'false', 'data-footnote-ref': '' });
      return { dom, ignoreMutation: () => true, update: (n: PMNode) => n.type.name === 'footnote' };
    };
  },
  addCommands() {
    return {
      insertFootnote: () => ({ state, tr, dispatch }) => {
        const pos = state.selection.to;
        const $pos = state.doc.resolve(pos);
        const parent = $pos.parent;
        if (!parent.inlineContent || parent.type.spec.code || parent.type.name === 'figure') return false;
        if (!parent.canReplaceWith($pos.index(), $pos.index(), this.type)) return false;
        if (dispatch) {
          const ref = freshRef();
          tr.insert(pos, this.type.create({ note: '', ref }));
          tr.setSelection(NodeSelection.create(tr.doc, pos)).scrollIntoView();
          const ui = this.storage.ui;
          requestAnimationFrame(() => ui?.openByRef(ref, true));
        }
        return true;
      },
    };
  },
  addKeyboardShortcuts() {
    return {
      [FOOTNOTE_KEY]: () => this.editor.commands.insertFootnote(),
      Enter: () => {
        const sel = this.editor.state.selection;
        if (!(sel instanceof NodeSelection) || sel.node.type !== this.type) return false;
        this.storage.ui?.open(sel.from);
        return true;
      },
    };
  },
  addProseMirrorPlugins() {
    const ext = this;
    return [
      new Plugin<DecorationSet>({
        key: numKey,
        state: {
          init: (_c, s) => decorate(s.doc),
          apply: (tr, set) => (tr.docChanged ? decorate(tr.doc) : set),
        },
        props: {
          decorations: (s) => numKey.getState(s),
          handleClickOn(_view, _pos, node, nodePos, event) {
            if (node.type !== ext.type) return false;
            event.preventDefault();
            ext.storage.ui?.open(nodePos);
            return true;
          },
        },
        view: (view: EditorView) => {
          ext.storage.ui?.render(view.state);
          return { update: (v) => ext.storage.ui?.render(v.state) };
        },
      }),
    ];
  },
  onCreate() {
    this.storage.ui = new FootnoteUI(this.editor);
    this.storage.ui.render(this.editor.state);
  },
  onDestroy() {
    this.storage.ui?.destroy();
    this.storage.ui = null;
  },
});

/** "/" menu entry. */
export const footnoteSlashItem: SlashItem = {
  id: 'footnote', title: 'Footnote / citation', hint: '[^1]', keywords: 'footnote citation cite note reference source ref', icon: footnoteIcon,
  run: (e, r) => {
    // "word /foot": the menu needed a space before "/", but the ref should hug the word.
    const from = r.from > 1 && e.state.doc.textBetween(r.from - 1, r.from) === ' ' && e.state.doc.resolve(r.from - 1).parent === e.state.doc.resolve(r.from).parent ? r.from - 1 : r.from;
    e.chain().focus().deleteRange({ from, to: r.to }).insertFootnote().run();
  },
};

/** Whether the footnote editor popover is open (to keep other menus out of the way). */
export const footnoteEditing = (editor: Editor) => !!(editor.storage as unknown as { footnote?: { ui: FootnoteUI | null } }).footnote?.ui?.isOpen;
