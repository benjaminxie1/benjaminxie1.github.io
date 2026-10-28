// Images as block figures: <figure><img src="/blog/x.webp" alt=""><figcaption>…</figcaption></figure>.
// The document only ever holds SITE paths. Local previews (blob: URLs) and upload progress live in
// the Uploads registry outside the document, so undo/redo can never put a blob URL into the HTML.
import { Node, mergeAttributes, type Editor } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { NodeView, EditorView } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { toDisplay } from '../lib';
import { h, icons } from './ui';

type Upload = { file: File; preview: string; status: 'uploading' | 'done' | 'error'; src?: string; error?: string };

export class Uploads {
  private map = new Map<string, Upload>();
  /** site path → URL that displays right now (blob preview from the uploader). */
  readonly previews = new Map<string, string>();
  private n = 0;
  private views = new Set<FigureView>();
  editor!: Editor;
  constructor(private upload: (f: File) => Promise<{ src: string; preview: string }>, private onPending: (n: number) => void, private onMessage?: (m: string, k?: 'info' | 'error') => void) {}

  get(id: string | null | undefined) { return id ? this.map.get(id) : undefined; }
  pending() { let n = 0; for (const u of this.map.values()) if (u.status === 'uploading') n++; return n; }
  display(src: string) { return this.previews.get(src) || toDisplay(src); }
  register(v: FigureView) { this.views.add(v); }
  unregister(v: FigureView) { this.views.delete(v); }

  /** Start uploading a file; returns the id to put on a figure node. */
  start(file: File): string {
    const id = `u${Date.now().toString(36)}${(this.n++).toString(36)}`;
    this.map.set(id, { file, preview: URL.createObjectURL(file), status: 'uploading' });
    this.run(id);
    return id;
  }
  retry(id: string) {
    const u = this.map.get(id);
    if (!u || u.status === 'uploading') return;
    u.status = 'uploading'; u.error = undefined;
    this.run(id);
  }
  private async run(id: string) {
    const u = this.map.get(id)!;
    this.changed(id);
    try {
      const res = await this.upload(u.file);
      if (!res || !res.src) throw new Error('Upload returned no image path');
      u.status = 'done'; u.src = res.src;
      this.previews.set(res.src, res.preview || u.preview);
    } catch (e) {
      u.status = 'error';
      u.error = (e as Error)?.message || 'Upload failed';
      this.onMessage?.(`Image didn't upload: ${u.error}`, 'error');
    }
    this.changed(id);
    // Let the resolver plugin write the final site path into the document (outside undo history).
    if (this.editor && !this.editor.isDestroyed) this.editor.view.dispatch(this.editor.state.tr.setMeta(resolveKey, id).setMeta('addToHistory', false));
  }
  private changed(id: string) {
    this.onPending(this.pending());
    for (const v of this.views) if (v.node.attrs.uploadId === id) v.render();
  }
  destroy() { this.views.clear(); }
}

const resolveKey = new PluginKey('edFigureResolve');

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/svg+xml', 'image/heic', 'image/heif'];

export function insertFiles(editor: Editor, uploads: Uploads, files: File[], pos?: number) {
  const imgs = files.filter((f) => f.type.startsWith('image/'));
  if (!imgs.length) return;
  const nodes = imgs.map((f) => ({ type: 'figure', attrs: { src: '', alt: '', uploadId: uploads.start(f) } }));
  const at = pos ?? editor.state.selection.from;
  const $at = editor.state.doc.resolve(Math.min(at, editor.state.doc.content.size));
  // Dropping into an empty paragraph replaces it rather than leaving a blank line behind.
  const target = $at.parent.type.name === 'paragraph' && $at.parent.content.size === 0 && $at.depth >= 1
    ? { from: $at.before(), to: $at.after() }
    : pos != null ? pos : { from: editor.state.selection.from, to: editor.state.selection.to };
  editor.chain().focus().insertContentAt(target, nodes).run();
}

export function pickFiles(multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept: 'image/*', multiple, hidden: true });
    inp.addEventListener('change', () => { resolve([...(inp.files || [])]); inp.remove(); });
    inp.addEventListener('cancel', () => { resolve([]); inp.remove(); });
    document.body.append(inp);
    inp.click();
  });
}

export const Figure = Node.create<{ uploads: Uploads | null }>({
  name: 'figure',
  group: 'block',
  content: 'inline*',
  marks: 'bold italic strike code link',
  draggable: true,
  selectable: true,
  isolating: true,
  defining: true,
  addOptions: () => ({ uploads: null }),
  addAttributes() {
    return {
      src: { default: '', parseHTML: (el) => (el.tagName === 'IMG' ? el : el.querySelector('img'))?.getAttribute('src') || '', renderHTML: () => ({}) },
      alt: { default: '', parseHTML: (el) => (el.tagName === 'IMG' ? el : el.querySelector('img'))?.getAttribute('alt') || '', renderHTML: () => ({}) },
      uploadId: { default: null, parseHTML: () => null, renderHTML: () => ({}) },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'figure',
        getAttrs: (el) => ((el as HTMLElement).querySelector('img') ? null : false),
        contentElement: (el) => (el as HTMLElement).querySelector('figcaption') || document.createElement('figcaption'),
      },
      { tag: 'img[src]', getContent: () => Fragment.empty, priority: 40 },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    const src = node.attrs.src as string;
    // A figure that has no real image yet is left out of getHTML() (see stripPending).
    if (!src) return ['figure', { 'data-ed-pending': '' }];
    const img = ['img', { src, alt: node.attrs.alt || '' }];
    if (!node.content.size) return ['figure', mergeAttributes(HTMLAttributes), img];
    return ['figure', mergeAttributes(HTMLAttributes), img, ['figcaption', 0]];
  },
  addNodeView() {
    return ({ node, editor, getPos }) => new FigureView(node, editor, getPos as () => number | undefined, this.options.uploads!);
  },
  addProseMirrorPlugins() {
    const uploads = this.options.uploads!;
    const type = this.type;
    return [
      new Plugin({
        key: resolveKey,
        // Whenever a figure carries an upload id whose upload has finished, write in its site path.
        appendTransaction(trs, _old, state) {
          if (!trs.some((t) => t.docChanged || t.getMeta(resolveKey))) return null;
          let tr = state.tr;
          let changed = false;
          state.doc.descendants((n, pos) => {
            if (n.type !== type) return n.isBlock && !n.isTextblock;
            const u = uploads.get(n.attrs.uploadId);
            if (n.attrs.uploadId && (!u || u.status === 'done')) {
              tr = tr.setNodeMarkup(pos, undefined, { ...n.attrs, src: u?.src || n.attrs.src, uploadId: null });
              changed = true;
            }
            return false;
          });
          return changed ? tr.setMeta('addToHistory', false) : null;
        },
        props: {
          // Typing while a figure is selected must not replace it: type into a new paragraph after it.
          handleTextInput(view, _from, _to, text) {
            const sel = view.state.selection;
            if (!(sel instanceof NodeSelection) || sel.node.type !== type) return false;
            const after = sel.to;
            const p = view.state.schema.nodes.paragraph.create(null, view.state.schema.text(text));
            const tr = view.state.tr.insert(after, p);
            view.dispatch(tr.setSelection(TextSelection.create(tr.doc, after + 1 + text.length)).scrollIntoView());
            return true;
          },
          handleKeyDown(view, e) {
            const sel = view.state.selection;
            if (!(sel instanceof NodeSelection) || sel.node.type !== type) return false;
            if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
              const after = sel.to;
              const tr = view.state.tr.insert(after, view.state.schema.nodes.paragraph.create());
              view.dispatch(tr.setSelection(TextSelection.create(tr.doc, after + 1)).scrollIntoView());
              return true;
            }
            return false;
          },
        },
      }),
    ];
  },
});

export class FigureView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private media: HTMLElement;
  private img: HTMLImageElement;
  private status: HTMLElement;
  private bar: HTMLElement;
  private altBtn: HTMLButtonElement;
  private altForm: HTMLFormElement;
  private altInput: HTMLInputElement;
  private shownSrc = '';

  constructor(public node: PMNode, private editor: Editor, private getPos: () => number | undefined, private uploads: Uploads) {
    this.img = h('img', { alt: '', draggable: 'false' });
    this.status = h('div', { class: 'ed-fig-status', 'aria-live': 'polite' });
    this.altBtn = h('button', { type: 'button', class: 'ed-btn ed-text-btn ed-fig-alt' }) as HTMLButtonElement;
    const replace = h('button', { type: 'button', class: 'ed-btn ed-text-btn', 'aria-label': 'Replace image' }, 'Replace');
    const remove = h('button', { type: 'button', class: 'ed-btn ed-icon-only', 'aria-label': 'Remove image', 'data-tip': 'Remove image', html: icons.trash });
    this.bar = h('div', { class: 'ed-pop ed-fig-bar', role: 'toolbar', 'aria-label': 'Image' }, this.altBtn, replace, remove);
    this.altInput = h('input', { type: 'text', class: 'ed-alt-input', placeholder: 'Describe the image for screen readers…', 'aria-label': 'Alt text', enterkeyhint: 'done' });
    this.altForm = h('form', { class: 'ed-pop ed-alt-form', hidden: true }, this.altInput, h('button', { type: 'submit', class: 'ed-btn ed-text-btn ed-primary' }, 'Save'));
    this.media = h('div', { class: 'ed-fig-media', contenteditable: 'false', 'data-drag-handle': '' }, this.img, this.status, this.bar, this.altForm);
    this.contentDOM = h('figcaption', { 'data-placeholder': 'Add a caption…' });
    this.dom = h('figure', { class: 'ed-figure' }, this.media, this.contentDOM);

    this.img.addEventListener('error', () => { if (this.img.getAttribute('src')) this.dom.classList.add('is-broken'); });
    this.img.addEventListener('load', () => this.dom.classList.remove('is-broken'));
    this.media.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest('button, input, form, a')) return;
      e.preventDefault();
      this.select();
    });
    for (const b of [this.altBtn, replace, remove]) b.addEventListener('mousedown', (e) => e.preventDefault());
    this.altBtn.addEventListener('click', () => this.openAlt());
    replace.addEventListener('click', async () => {
      const [f] = await pickFiles(false);
      if (!f) return;
      this.setAttrs({ uploadId: this.uploads.start(f) });
    });
    remove.addEventListener('click', () => this.remove());
    this.altForm.addEventListener('submit', (e) => { e.preventDefault(); this.setAttrs({ alt: this.altInput.value.trim() }); this.closeAlt(); });
    this.altInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.closeAlt(); } });
    this.altForm.addEventListener('focusout', (e) => {
      if (e.relatedTarget && this.altForm.contains(e.relatedTarget as Node)) return;
      setTimeout(() => { if (!this.altForm.hidden && !this.altForm.contains(document.activeElement)) { this.setAttrs({ alt: this.altInput.value.trim() }); this.closeAlt(false); } }, 0);
    });
    this.uploads.register(this);
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
    this.editor.view.dispatch(this.editor.state.tr.setNodeMarkup(p, undefined, { ...n.attrs, ...a }));
  }
  private remove() {
    const p = this.pos(); if (p == null) return;
    this.editor.chain().focus().deleteRange({ from: p, to: p + this.node.nodeSize }).run();
  }
  private openAlt() {
    this.altInput.value = this.node.attrs.alt || '';
    this.altForm.hidden = false;
    this.dom.classList.add('is-alt-open');
    this.altInput.focus({ preventScroll: true });
  }
  private closeAlt(refocus = true) {
    this.altForm.hidden = true;
    this.dom.classList.remove('is-alt-open');
    if (refocus) this.select();
  }

  render() {
    const { src, alt, uploadId } = this.node.attrs as { src: string; alt: string; uploadId: string | null };
    const u = this.uploads.get(uploadId);
    const show = u && u.status !== 'done' ? u.preview : u?.src ? this.uploads.display(u.src) : src ? this.uploads.display(src) : '';
    if (show !== this.shownSrc) { this.shownSrc = show; this.dom.classList.remove('is-broken'); if (show) this.img.src = show; else this.img.removeAttribute('src'); }
    this.media.dataset.src = src || '';
    this.img.alt = alt || '';
    const state = u?.status === 'uploading' ? 'uploading' : u?.status === 'error' ? 'error' : '';
    this.dom.dataset.state = state;
    this.status.replaceChildren();
    if (state === 'uploading') {
      this.status.append(h('span', { class: 'ed-fig-progress' }, 'Uploading…'));
    } else if (state === 'error') {
      const retry = h('button', { type: 'button', class: 'ed-btn ed-text-btn ed-primary' }, 'Retry');
      const rm = h('button', { type: 'button', class: 'ed-btn ed-text-btn' }, 'Remove');
      retry.addEventListener('click', () => this.uploads.retry(uploadId!));
      rm.addEventListener('click', () => this.remove());
      this.status.append(h('span', { class: 'ed-fig-err', role: 'alert' }, h('strong', {}, "Couldn't upload."), ' ', u?.error || ''), h('span', { class: 'ed-fig-err-actions' }, retry, rm));
    }
    this.altBtn.textContent = alt ? 'Alt ✓' : 'Add alt text';
    this.altBtn.classList.toggle('ed-nudge', !alt);
    this.altBtn.setAttribute('aria-label', alt ? `Edit alt text: ${alt}` : 'Add alt text (describes the image for screen readers)');
    this.altBtn.dataset.tip = alt ? `Alt: ${alt}` : 'Describe the image for people who can’t see it';
    this.contentDOM.classList.toggle('is-empty', this.node.content.size === 0);
  }

  update(node: PMNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }
  selectNode() { this.dom.classList.add('is-selected'); }
  deselectNode() { this.dom.classList.remove('is-selected'); if (!this.altForm.hidden && !this.altForm.contains(document.activeElement)) this.closeAlt(false); }
  stopEvent(e: Event) {
    const t = e.target as HTMLElement;
    if (this.media.contains(t) && t.closest('button, input, form')) return true;
    return false;
  }
  ignoreMutation(m: MutationRecord | { type: 'selection'; target: globalThis.Node }) {
    if (m.type === 'selection') return !this.contentDOM.contains(m.target);
    return !this.contentDOM.contains(m.target);
  }
  destroy() { this.uploads.unregister(this); }
}

/** Remove figures that have no real image yet (still uploading / failed) from serialized HTML. */
export const stripPending = (html: string) => html.replace(/<figure data-ed-pending="">(?:<\/figure>)?/g, '').replace(/<figure data-ed-pending=""><\/figure>/g, '');
export type { EditorView };
