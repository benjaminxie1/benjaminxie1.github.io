// Side-by-side images: <div class="gallery [size-wide|size-full]"><figure>…</figure>…<p class="gallery-caption">…</p></div>
// Each image keeps its own figure (alt, caption, crop); the row adds an optional caption for all of them.
// Markdown form: see markdown-images.ts. A row left with one image turns back into a plain image.
import { Node, type Editor } from '@tiptap/core';
import { NodeSelection, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { NodeView } from '@tiptap/pm/view';
import { h, icons } from './ui';
import { imgIcons, GALLERY_MAX } from './images';
import { pickFiles, insertFiles, type Uploads } from './figure';
import type { SlashItem } from './slash';

const normKey = new PluginKey('edGalleryNormalize');

export const GalleryCaption = Node.create({
  name: 'galleryCaption',
  content: 'inline*',
  marks: '',
  defining: true,
  parseHTML: () => [{ tag: 'p.gallery-caption', priority: 60 }],
  renderHTML: () => ['p', { class: 'gallery-caption' }, 0],
  addNodeView() {
    return ({ node }) => {
      const dom = h('p', { class: 'gallery-caption', 'data-placeholder': 'Caption for the row (optional)' });
      const sync = (n: PMNode) => dom.classList.toggle('is-empty', n.content.size === 0);
      sync(node);
      return { dom, contentDOM: dom, update: (n: PMNode) => { if (n.type !== node.type) return false; sync(n); return true; } };
    };
  },
});

export const Gallery = Node.create<{ uploads: Uploads | null }>({
  name: 'gallery',
  group: 'block',
  content: 'figure+ galleryCaption',
  draggable: true,
  selectable: true,
  isolating: true,
  addOptions: () => ({ uploads: null }),
  addAttributes() {
    return {
      size: {
        default: 'normal',
        parseHTML: (el) => (el.className.match(/(?:^|\s)size-(wide|full)(?:\s|$)/) || [])[1] || 'normal',
        renderHTML: () => ({}),
      },
    };
  },
  parseHTML: () => [{ tag: 'div.gallery', priority: 60 }],
  renderHTML({ node }) {
    const size = node.attrs.size;
    return ['div', { class: 'gallery' + (size && size !== 'normal' ? ` size-${size}` : '') }, 0];
  },
  addNodeView() {
    return ({ node, editor, getPos }) => new GalleryView(node, editor, getPos as () => number | undefined, this.options.uploads!);
  },
  addProseMirrorPlugins() {
    const type = this.type;
    return [
      new Plugin({
        key: normKey,
        // A row needs two images: when one is left (others removed or dragged out), it becomes a plain image.
        appendTransaction(trs, _old, state) {
          if (!trs.some((t) => t.docChanged)) return null;
          const lone: Array<{ pos: number; node: PMNode }> = [];
          state.doc.descendants((n, pos) => {
            if (n.type === type) { if (n.childCount - 1 < 2) lone.push({ pos, node: n }); return false; }
            return n.isBlock && !n.isTextblock;
          });
          if (!lone.length) return null;
          let tr = state.tr;
          for (const { pos, node } of lone.reverse()) {
            const figs: PMNode[] = [];
            let cap: PMNode | null = null;
            node.forEach((c) => { if (c.type.name === 'figure') figs.push(c); else cap = c; });
            const capNode = cap as PMNode | null;
            const out: PMNode[] = figs.map((f, i) => (i === figs.length - 1 && capNode && capNode.content.size && !f.content.size ? f.type.create(f.attrs, capNode.content) : f));
            tr = tr.replaceWith(pos, pos + node.nodeSize, out);
          }
          return tr;
        },
        props: {
          handleKeyDown(view, e) {
            const sel = view.state.selection;
            if (!(sel instanceof TextSelection) || sel.$from.parent.type.name !== 'galleryCaption') return false;
            const $f = sel.$from;
            // Enter in the row caption: continue writing below the row
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
              const after = $f.after(-1);
              const next = view.state.doc.nodeAt(after);
              let tr = view.state.tr;
              if (!(next && next.type.name === 'paragraph' && next.content.size === 0)) tr = tr.insert(after, view.state.schema.nodes.paragraph.create());
              view.dispatch(tr.setSelection(TextSelection.create(tr.doc, after + 1)).scrollIntoView());
              return true;
            }
            // Backspace at the start of the row caption: select the last image instead of merging
            if (e.key === 'Backspace' && sel.empty && $f.parentOffset === 0) {
              const gal = $f.node(-1);
              const last = $f.before() - gal.child(gal.childCount - 2).nodeSize;
              view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, last)));
              return true;
            }
            return false;
          },
        },
      }),
    ];
  },
});

class GalleryView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private bar: HTMLElement;
  private sizeBtns: HTMLButtonElement[];
  private addBtn: HTMLButtonElement;
  private off: () => void;

  constructor(public node: PMNode, private editor: Editor, private getPos: () => number | undefined, private uploads: Uploads) {
    const SIZES: Array<[string, string, string]> = [['normal', 'Text width', imgIcons.normal], ['wide', 'Wide', imgIcons.wide], ['full', 'Full width', imgIcons.full]];
    this.sizeBtns = SIZES.map(([size, label, icon]) => {
      const b = h('button', { type: 'button', class: 'ed-btn ed-icon-only', 'aria-label': `Row: ${label}`, 'data-tip': label, 'aria-pressed': 'false', 'data-size': size, html: icon }) as HTMLButtonElement;
      b.addEventListener('click', () => this.setAttrs({ size }));
      return b;
    });
    this.addBtn = h('button', { type: 'button', class: 'ed-btn ed-text-btn', 'aria-label': 'Add an image to this row' }, h('span', { html: imgIcons.plus }), 'Image') as HTMLButtonElement;
    const stack = h('button', { type: 'button', class: 'ed-btn ed-text-btn', 'aria-label': 'Stack these images instead', 'data-tip': 'One image per line' }, h('span', { html: imgIcons.stack }), 'Stack');
    const remove = h('button', { type: 'button', class: 'ed-btn ed-icon-only', 'aria-label': 'Remove these images', 'data-tip': 'Remove row', html: icons.trash });
    this.bar = h('div', { class: 'ed-pop ed-gallery-bar', role: 'toolbar', 'aria-label': 'Images side by side', contenteditable: 'false' },
      h('span', { class: 'ed-gallery-label', 'aria-hidden': 'true', html: imgIcons.row }), ...this.sizeBtns, h('span', { class: 'ed-sep' }), this.addBtn, stack, remove);
    this.contentDOM = h('div', { class: 'ed-gallery-items' });
    this.dom = h('div', { class: 'gallery ed-gallery' }, this.bar, this.contentDOM);
    for (const b of [...this.sizeBtns, this.addBtn, stack, remove]) b.addEventListener('mousedown', (e) => e.preventDefault());
    this.addBtn.addEventListener('click', () => this.add());
    stack.addEventListener('click', () => this.stack());
    remove.addEventListener('click', () => { const p = this.pos(); if (p != null) this.editor.chain().focus().deleteRange({ from: p, to: p + this.node.nodeSize }).run(); });
    const onSel = () => this.syncActive();
    editor.on('selectionUpdate', onSel);
    editor.on('transaction', onSel);
    this.off = () => { editor.off('selectionUpdate', onSel); editor.off('transaction', onSel); };
    this.render();
  }

  private pos() { const p = this.getPos(); return typeof p === 'number' ? p : null; }
  private setAttrs(a: Record<string, unknown>) {
    const p = this.pos(); if (p == null) return;
    const st = this.editor.state;
    const tr = st.tr.setNodeMarkup(p, undefined, { ...this.node.attrs, ...a });
    if (st.selection instanceof NodeSelection) { const q = tr.mapping.map(st.selection.from, -1); if (tr.doc.nodeAt(q)) tr.setSelection(NodeSelection.create(tr.doc, q)); }
    this.editor.view.dispatch(tr);
  }
  private async add() {
    const room = GALLERY_MAX - (this.node.childCount - 1);
    const files = (await pickFiles(room > 1)).slice(0, Math.max(1, room));
    const p = this.pos(); if (p == null || !files.length) return;
    const capPos = p + this.node.nodeSize - 1 - this.node.lastChild!.nodeSize; // before the row caption
    const figs = files.filter((f) => f.type.startsWith('image/')).map((f) => this.editor.schema.nodes.figure.create({ src: '', alt: '', uploadId: this.uploads.start(f) }));
    if (figs.length) this.editor.view.dispatch(this.editor.state.tr.insert(capPos, figs));
  }
  /** Back to one image per line; a row caption moves onto the last image (or below, as text). */
  private stack() {
    const p = this.pos(); if (p == null) return;
    const figs: PMNode[] = [];
    let cap: PMNode | null = null;
    this.node.forEach((c) => { if (c.type.name === 'figure') figs.push(c); else cap = c; });
    const capNode = cap as PMNode | null;
    const out = [...figs];
    if (capNode && capNode.content.size) {
      const last = out[out.length - 1];
      if (!last.content.size) out[out.length - 1] = last.type.create(last.attrs, capNode.content);
      else out.push(this.editor.schema.nodes.paragraph.create(null, capNode.content));
    }
    this.editor.chain().focus().command(({ tr }) => { tr.replaceWith(p, p + this.node.nodeSize, out); return true; }).run();
  }
  private syncActive() {
    const p = this.pos();
    if (p == null || this.editor.isDestroyed) return;
    const { from, to } = this.editor.state.selection;
    const inside = from >= p && to <= p + this.node.nodeSize;
    this.dom.classList.toggle('is-active', inside);
  }
  render() {
    const size = this.node.attrs.size || 'normal';
    for (const c of ['size-wide', 'size-full']) this.dom.classList.toggle(c, c === `size-${size}`);
    for (const b of this.sizeBtns) b.setAttribute('aria-pressed', String(b.dataset.size === size));
    this.dom.dataset.count = String(this.node.childCount - 1);
    this.addBtn.hidden = this.node.childCount - 1 >= GALLERY_MAX;
  }
  update(node: PMNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }
  selectNode() { this.dom.classList.add('is-selected'); }
  deselectNode() { this.dom.classList.remove('is-selected'); }
  stopEvent(e: Event) { return this.bar.contains(e.target as globalThis.Node); }
  ignoreMutation(m: MutationRecord | { type: 'selection'; target: globalThis.Node }) {
    return !this.contentDOM.contains(m.target);
  }
  destroy() { this.off(); }
}

/** "/" menu: Gallery — pick 2–3 images to show side by side. */
export const gallerySlashItem = (uploads: () => Uploads): SlashItem => ({
  id: 'gallery',
  title: 'Gallery',
  hint: 'side by side',
  keywords: 'images row grid columns photos pictures pair side by side',
  icon: imgIcons.row,
  run: async (e, r) => {
    e.chain().focus().deleteRange(r).run();
    const pos = e.state.selection.from;
    const files = await pickFiles(true);
    if (files.length) insertFiles(e, uploads(), files, Math.min(pos, e.state.doc.content.size), 'row');
  },
});
