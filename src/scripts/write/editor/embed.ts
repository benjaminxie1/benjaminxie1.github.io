// Video embeds as block atoms: attrs { provider, id, start, caption } — never a raw iframe src.
// In the editor a light poster stands in for the player (click ▶ to load the real iframe).
// HTML/markdown form and all URL parsing live in ../markdown-embed.ts.
import { Node, Extension, type Editor, type Range } from '@tiptap/core';
import { NodeSelection, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { NodeView } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { h, icons, Floater } from './ui';
import type { SlashItem } from './slash';
import { smartPunctuation } from './typing';
import {
  type EmbedAttrs, cleanAttrs, parseVideoUrl, parseEmbedElement, embedSrc, posterUrl, pageUrl, providerName, EMBED_ALLOW,
} from '../markdown-embed';

const svg = (d: string) => `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const videoIcon = svg('<rect x="1.8" y="3.2" width="12.4" height="9.6" rx="2.2"/><path d="m6.7 6.1 3.2 1.9-3.2 1.9z" fill="currentColor"/>');
const playGlyph = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>';
const BAD_LINK = 'That doesn’t look like a YouTube, Vimeo or Loom link.';

const attrsOf = (n: PMNode) => cleanAttrs(n.attrs) as EmbedAttrs | null;

export const Embed = Node.create({
  name: 'embed',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    // parseHTML on each attr is unused: getAttrs below sets all of them from one validated parse.
    return {
      provider: { default: null, renderHTML: () => ({}) },
      id: { default: null, renderHTML: () => ({}) },
      start: { default: null, renderHTML: () => ({}) },
      caption: { default: '', renderHTML: () => ({}) },
    };
  },
  parseHTML() {
    const getAttrs = (el: HTMLElement) => parseEmbedElement(el) || false;
    return [
      { tag: 'figure.embed', priority: 70, getAttrs },
      { tag: 'div.embed', priority: 70, getAttrs },
      { tag: 'iframe', priority: 70, getAttrs },
    ];
  },
  renderHTML({ node }) {
    // Same structure as markdown-embed.ts embedHtml(); turndown rebuilds it from attrs anyway.
    const a = attrsOf(node);
    if (!a) return ['div', { 'data-ed-pending': '' }];
    const iframe = ['iframe', { src: embedSrc(a), title: a.caption || `${providerName(a.provider)} video`, loading: 'lazy', allow: EMBED_ALLOW, allowfullscreen: '' }];
    const cls = `embed embed-${a.provider}`;
    return a.caption ? ['figure', { class: cls }, iframe, ['figcaption', {}, a.caption]] : ['div', { class: cls }, iframe];
  },
  addNodeView() {
    return ({ node, editor, getPos }) => new EmbedView(node, editor, getPos as () => number | undefined);
  },
  addProseMirrorPlugins() {
    const type = this.type;
    return [
      new Plugin({
        key: new PluginKey('edEmbedKeys'),
        props: {
          // Typing / Enter while an embed is selected continues in a new paragraph after it.
          handleTextInput(view, _f, _t, text) {
            const sel = view.state.selection;
            if (!(sel instanceof NodeSelection) || sel.node.type !== type) return false;
            const tr = view.state.tr.insert(sel.to, view.state.schema.nodes.paragraph.create(null, view.state.schema.text(text)));
            view.dispatch(tr.setSelection(TextSelection.create(tr.doc, sel.to + 1 + text.length)).scrollIntoView());
            return true;
          },
          handleKeyDown(view, e) {
            const sel = view.state.selection;
            if (!(sel instanceof NodeSelection) || sel.node.type !== type) return false;
            if (e.key !== 'Enter' || e.shiftKey || e.metaKey || e.ctrlKey) return false;
            const tr = view.state.tr.insert(sel.to, view.state.schema.nodes.paragraph.create());
            view.dispatch(tr.setSelection(TextSelection.create(tr.doc, sel.to + 1)).scrollIntoView());
            return true;
          },
        },
      }),
    ];
  },
});

/** Insert an embed at pos, replacing the empty paragraph there (if any); selects it. */
export function insertEmbed(editor: Editor, attrs: EmbedAttrs, pos = editor.state.selection.from) {
  const { state } = editor;
  const $p = state.doc.resolve(Math.min(pos, state.doc.content.size));
  const node = state.schema.nodes.embed.create(attrs);
  let tr = state.tr;
  let at: number;
  if ($p.parent.type.name === 'paragraph' && $p.parent.content.size === 0 && $p.depth >= 1) {
    at = $p.before();
    tr = tr.replaceWith(at, $p.after(), node);
  } else {
    at = $p.depth >= 1 ? $p.after(1) : pos;
    tr = tr.insert(at, node);
  }
  tr = tr.setSelection(NodeSelection.create(tr.doc, at)).scrollIntoView();
  editor.view.dispatch(tr);
  editor.view.focus();
}

/** Paste a bare video URL on an empty line → embed. Anything else pastes normally. */
export const EmbedPaste = Extension.create({
  name: 'edEmbedPaste',
  priority: 1000, // ahead of Link's paste handling
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey('edEmbedPaste'),
        props: {
          handlePaste(view, e) {
            const sel = view.state.selection;
            if (!sel.empty || !sel.$from.parent.isTextblock || sel.$from.parent.type.name !== 'paragraph' || sel.$from.parent.content.size !== 0) return false;
            const text = e.clipboardData?.getData('text/plain') || '';
            const a = parseVideoUrl(text);
            if (!a) return false;
            e.preventDefault();
            insertEmbed(editor, a, sel.from);
            return true;
          },
        },
      }),
    ];
  },
});

// ---------- small inline URL field (slash "Video", and "Replace link") ----------
let field: { floater: Floater; close: (refocus?: boolean) => void } | null = null;

export function openVideoField(editor: Editor, opts: { anchor: () => DOMRect | null; initial?: string; onSubmit: (a: EmbedAttrs) => void }) {
  field?.close(false);
  const input = h('input', { type: 'text', class: 'ed-embed-input', placeholder: 'Paste a YouTube, Vimeo or Loom link…', 'aria-label': 'Video link', enterkeyhint: 'done', autocomplete: 'off', spellcheck: 'false' });
  input.value = opts.initial || '';
  const err = h('div', { class: 'ed-embed-err', role: 'alert', hidden: true });
  const form = h('form', { class: 'ed-pop ed-embed-field' },
    h('div', { class: 'ed-embed-row' }, input, h('button', { type: 'submit', class: 'ed-btn ed-text-btn ed-primary' }, 'Embed')), err);
  const floater = new Floater(form, 'bottom-start', 8);
  let closed = false;
  const close = (refocus = true) => {
    if (closed) return; closed = true;
    floater.hide();
    if (field?.floater === floater) field = null;
    if (refocus && !editor.isDestroyed) editor.view.focus();
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const a = parseVideoUrl(input.value);
    if (!a) { err.textContent = input.value.trim() ? BAD_LINK : 'Paste a link to a video.'; err.hidden = false; input.focus(); return; }
    close(false);
    opts.onSubmit(a);
  });
  input.addEventListener('input', () => { err.hidden = true; });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } });
  form.addEventListener('focusout', (e) => {
    if (e.relatedTarget && form.contains(e.relatedTarget as globalThis.Node)) return;
    setTimeout(() => { if (!closed && !form.contains(document.activeElement)) close(false); }, 0);
  });
  floater.show(opts.anchor);
  field = { floater, close };
  input.focus({ preventScroll: true });
  if (input.value) input.select();
}

/** The "/" menu item. */
export const videoSlashItem: SlashItem = {
  id: 'video', title: 'Video', hint: 'link', keywords: 'youtube vimeo loom embed movie clip iframe', icon: videoIcon,
  run: (editor: Editor, range: Range) => {
    editor.chain().focus().deleteRange(range).run();
    const pos = editor.state.selection.from;
    openVideoField(editor, {
      anchor: () => { try { const c = editor.view.coordsAtPos(pos); return new DOMRect(c.left, c.top, 1, c.bottom - c.top); } catch { return null; } },
      onSubmit: (a) => insertEmbed(editor, a, Math.min(pos, editor.state.doc.content.size)),
    });
  },
};
/** Slash items with "Video" placed right after "Image". */
export function withVideo(items: SlashItem[]): SlashItem[] {
  const i = items.findIndex((it) => it.id === 'image');
  const out = items.slice();
  out.splice(i < 0 ? out.length : i + 1, 0, videoSlashItem);
  return out;
}

// ---------- node view ----------
class EmbedView implements NodeView {
  dom: HTMLElement;
  private media: HTMLElement;
  private stage: HTMLElement;
  private cap: HTMLElement;
  private bar: HTMLElement;
  private capForm: HTMLFormElement;
  private capInput: HTMLInputElement;
  private capBtn: HTMLButtonElement;
  private shown = '';

  constructor(public node: PMNode, private editor: Editor, private getPos: () => number | undefined) {
    this.stage = h('div', { class: 'ed-embed-stage' });
    this.capBtn = h('button', { type: 'button', class: 'ed-btn ed-text-btn' }) as HTMLButtonElement;
    const replace = h('button', { type: 'button', class: 'ed-btn ed-text-btn', 'aria-label': 'Replace video link' }, 'Replace link');
    const remove = h('button', { type: 'button', class: 'ed-btn ed-icon-only', 'aria-label': 'Remove video', 'data-tip': 'Remove video', html: icons.trash });
    this.bar = h('div', { class: 'ed-pop ed-fig-bar ed-embed-bar', role: 'toolbar', 'aria-label': 'Video' }, this.capBtn, replace, remove);
    this.capInput = h('input', { type: 'text', class: 'ed-alt-input', placeholder: 'Caption (optional)…', 'aria-label': 'Caption', enterkeyhint: 'done', maxlength: '300' });
    smartPunctuation(this.capInput);
    this.capForm = h('form', { class: 'ed-pop ed-alt-form', hidden: true }, this.capInput, h('button', { type: 'submit', class: 'ed-btn ed-text-btn ed-primary' }, 'Save'));
    this.media = h('div', { class: 'ed-embed-media', contenteditable: 'false', 'data-drag-handle': '' }, this.stage, this.bar, this.capForm);
    this.cap = h('figcaption', { class: 'ed-embed-cap', contenteditable: 'false' });
    this.dom = h('figure', { class: 'embed ed-embed', contenteditable: 'false' }, this.media, this.cap);

    this.media.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest('button, input, form, a, iframe')) return;
      e.preventDefault();
      this.select();
    });
    this.cap.addEventListener('mousedown', (e) => { e.preventDefault(); this.select(); this.openCaption(); });
    for (const b of [this.capBtn, replace, remove]) b.addEventListener('mousedown', (e) => e.preventDefault());
    this.capBtn.addEventListener('click', () => this.openCaption());
    remove.addEventListener('click', () => {
      const p = this.pos(); if (p == null) return;
      this.editor.chain().focus().deleteRange({ from: p, to: p + this.node.nodeSize }).run();
    });
    replace.addEventListener('click', () => {
      const a = attrsOf(this.node);
      openVideoField(this.editor, {
        anchor: () => this.media.getBoundingClientRect(),
        initial: a ? pageUrl(a) : '',
        onSubmit: (n) => { this.setAttrs({ provider: n.provider, id: n.id, start: n.start }); this.select(); },
      });
    });
    this.capForm.addEventListener('submit', (e) => { e.preventDefault(); this.saveCaption(); this.closeCaption(); });
    this.capInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.closeCaption(); } });
    this.capForm.addEventListener('focusout', (e) => {
      if (e.relatedTarget && this.capForm.contains(e.relatedTarget as globalThis.Node)) return;
      setTimeout(() => { if (!this.capForm.hidden && !this.capForm.contains(document.activeElement)) { this.saveCaption(); this.closeCaption(false); } }, 0);
    });
    this.render();
  }

  private pos() { const p = this.getPos(); return typeof p === 'number' ? p : null; }
  private select() {
    const p = this.pos(); if (p == null) return;
    this.editor.view.dispatch(this.editor.state.tr.setSelection(NodeSelection.create(this.editor.state.doc, p)));
    this.editor.view.focus();
  }
  private setAttrs(a: Record<string, unknown>) {
    const p = this.pos(); if (p == null) return;
    const n = this.editor.state.doc.nodeAt(p); if (!n) return;
    const next = cleanAttrs({ ...n.attrs, ...a });
    if (next) this.editor.view.dispatch(this.editor.state.tr.setNodeMarkup(p, undefined, next));
  }
  private openCaption() {
    this.capInput.value = this.node.attrs.caption || '';
    this.capForm.hidden = false;
    this.dom.classList.add('is-alt-open');
    this.capInput.focus({ preventScroll: true });
  }
  private saveCaption() { if (this.capInput.value.trim() !== (this.node.attrs.caption || '')) this.setAttrs({ caption: this.capInput.value }); }
  private closeCaption(refocus = true) {
    this.capForm.hidden = true;
    this.dom.classList.remove('is-alt-open');
    if (refocus) this.select();
  }

  /** Swap the poster for the real player (only on click). */
  private play(a: EmbedAttrs) {
    const iframe = document.createElement('iframe');
    const src = new URL(embedSrc(a));
    if (a.provider !== 'vimeo') src.searchParams.set('autoplay', '1');
    iframe.src = src.toString();
    iframe.title = a.caption || `${providerName(a.provider)} video`;
    iframe.allow = EMBED_ALLOW + '; autoplay';
    iframe.allowFullscreen = true;
    iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    this.stage.replaceChildren(iframe);
    this.stage.classList.add('is-playing');
  }

  render() {
    const a = attrsOf(this.node);
    const key = a ? `${a.provider}:${a.id}:${a.start ?? ''}` : '';
    if (key !== this.shown) {
      this.shown = key;
      this.stage.classList.remove('is-playing');
      this.dom.className = `embed ed-embed${a ? ` embed-${a.provider}` : ''}`;
      if (!a) this.stage.replaceChildren(h('div', { class: 'ed-embed-poster' }, h('span', { class: 'ed-embed-label' }, 'Video unavailable')));
      else {
        const name = providerName(a.provider);
        const poster = h('div', { class: 'ed-embed-poster' });
        const thumb = posterUrl(a);
        if (thumb) {
          const img = h('img', { src: thumb, alt: '', draggable: 'false', referrerpolicy: 'no-referrer', loading: 'lazy' });
          img.addEventListener('error', () => img.remove());
          poster.append(img);
        }
        const play = h('button', { type: 'button', class: 'ed-embed-play', 'aria-label': `Play ${name} video`, html: playGlyph });
        play.addEventListener('mousedown', (e) => e.preventDefault());
        play.addEventListener('click', () => this.play(a));
        poster.append(play, h('span', { class: 'ed-embed-label' }, name + (a.start ? ` · from ${fmt(a.start)}` : '')));
        this.stage.replaceChildren(poster);
      }
    }
    const caption = (this.node.attrs.caption as string) || '';
    this.cap.textContent = caption;
    this.cap.hidden = !caption;
    this.capBtn.textContent = caption ? 'Edit caption' : 'Add caption';
  }

  update(node: PMNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }
  selectNode() { this.dom.classList.add('is-selected'); }
  deselectNode() { this.dom.classList.remove('is-selected'); if (!this.capForm.hidden && !this.capForm.contains(document.activeElement)) this.closeCaption(false); }
  stopEvent(e: Event) {
    const t = e.target as HTMLElement;
    return !!(this.media.contains(t) && t.closest('button, input, form, iframe'));
  }
  ignoreMutation() { return true; }
}

const fmt = (s: number) => {
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return hh ? `${hh}:${two(mm)}:${two(ss)}` : `${mm}:${two(ss)}`;
};
