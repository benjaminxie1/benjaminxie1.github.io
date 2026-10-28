// Quotes & callouts: quote-with-source (a decoration on blockquote), pull quote, callout, toggle.
// Editor HTML (and the markdown each one becomes, see markdown-blocks.ts):
//   <blockquote><p>…</p><p>— Source</p></blockquote>      > …\n>\n> — Source
//   <aside class="pullquote"><p>…</p></aside>              <aside class="pullquote">\n\n…\n\n</aside>
//   <aside class="callout">…blocks…</aside>                <aside class="callout">\n\n…\n\n</aside>
//   <details><summary>Title</summary>…blocks…</details>    <details>\n<summary>Title</summary>\n\n…\n\n</details>
import { Node, Extension, type Editor, type Range } from '@tiptap/core';
import { Fragment, type Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type ViewMutationRecord } from '@tiptap/pm/view';
import type { SlashItem } from './slash';

// ---------- quote source ----------
/** The source line of a quote: its last paragraph (never the only one) when it starts with an em dash. */
export const isQuoteSource = (quote: PMNode, child: PMNode, index: number) =>
  index > 0 && index === quote.childCount - 1 && child.type.name === 'paragraph' && /^\s*—/.test(child.textContent);

const sourceKey = new PluginKey('edQuoteSource');
function sourceDecorations(doc: PMNode) {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'blockquote') return node.isBlock && !node.isTextblock;
    node.forEach((child, offset, i) => {
      if (!isQuoteSource(node, child, i)) return;
      const empty = child.textContent.trim() === '—';
      const at = pos + 1 + offset;
      decos.push(Decoration.node(at, at + child.nodeSize, empty ? { class: 'quote-source is-source-empty', 'data-source-placeholder': 'Who said it?' } : { class: 'quote-source' }));
    });
    return true; // quotes can hold quotes
  });
  return DecorationSet.create(doc, decos);
}

export const QuoteSource = Extension.create({
  name: 'edQuoteSource',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: sourceKey,
        state: {
          init: (_c, state) => sourceDecorations(state.doc),
          apply: (tr, old) => (tr.docChanged ? sourceDecorations(tr.doc) : old),
        },
        props: { decorations: (state) => sourceKey.getState(state) },
      }),
    ];
  },
});

// ---------- pull quote & callout ----------
export const Pullquote = Node.create({
  name: 'pullquote',
  group: 'block',
  content: 'paragraph+',
  defining: true,
  parseHTML: () => [{ tag: 'aside.pullquote' }],
  renderHTML: () => ['aside', { class: 'pullquote' }, 0],
});

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  parseHTML: () => [{ tag: 'aside.callout' }],
  renderHTML: () => ['aside', { class: 'callout' }, 0],
});

// ---------- toggle (details / summary) ----------
export const DetailsSummary = Node.create({
  name: 'detailsSummary',
  content: 'text*',
  marks: '', // the summary line is plain text (it sits inside an HTML block in markdown)
  defining: true,
  isolating: true,
  selectable: false,
  parseHTML: () => [{ tag: 'summary' }],
  renderHTML: () => ['summary', 0],
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div');
      dom.className = 'ed-summary';
      dom.dataset.placeholder = 'Toggle title';
      const sync = (n: PMNode) => dom.classList.toggle('is-empty', n.content.size === 0);
      sync(node);
      // The ▸ marker (the summary's left padding) folds the toggle in the editor; text clicks just place the caret.
      dom.addEventListener('mousedown', (e) => {
        const pad = parseFloat(getComputedStyle(dom).paddingLeft) || 0;
        if (e.clientX - dom.getBoundingClientRect().left > pad) return;
        e.preventDefault();
        dom.parentElement?.classList.toggle('is-open');
      });
      return { dom, contentDOM: dom, update: (n: PMNode) => { if (n.type !== node.type) return false; sync(n); return true; }, ignoreMutation: (m: ViewMutationRecord) => m.type === 'attributes' && m.target === dom };
    };
  },
});

export const Details = Node.create({
  name: 'details',
  group: 'block',
  content: 'detailsSummary block+',
  defining: true,
  isolating: true,
  parseHTML: () => [{ tag: 'details' }],
  renderHTML: () => ['details', 0],
  addNodeView() {
    // Open by default while writing; the post page starts closed.
    return ({ node }) => {
      const dom = document.createElement('div');
      dom.className = 'ed-details is-open';
      // folding only changes a class: not a document change
      return { dom, contentDOM: dom, update: (n: PMNode) => n.type === node.type, ignoreMutation: (m: ViewMutationRecord) => m.type === 'attributes' && m.target === dom };
    };
  },
  addKeyboardShortcuts() {
    const inSummary = (ed: Editor) => ed.state.selection.$from.parent.type.name === 'detailsSummary';
    return {
      // Enter in the title goes to the toggle's body.
      Enter: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        // Enter on an empty last line of the body leaves the toggle (it's isolating, so lift won't).
        if (empty && !inSummary(editor) && $from.depth >= 2 && $from.parent.type.name === 'paragraph' && $from.parent.content.size === 0) {
          const details = $from.node(-1);
          if (details.type.name !== 'details' || $from.index(-1) !== details.childCount - 1) return false;
          const p = editor.state.schema.nodes.paragraph.create();
          let tr = editor.state.tr;
          let at = $from.after(-1);
          if (details.childCount > 2) { tr = tr.delete($from.before(), $from.after()); at -= 2; }
          tr = tr.insert(at, p);
          editor.view.dispatch(tr.setSelection(TextSelection.create(tr.doc, at + 1)).scrollIntoView());
          return true;
        }
        if (!inSummary(editor)) return false;
        const after = $from.after();
        const tr = editor.state.tr;
        editor.view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(after + 1))).scrollIntoView());
        return true;
      },
      // Backspace in an empty title unwraps the toggle (its body stays).
      Backspace: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        if (!empty || !inSummary(editor) || $from.parent.content.size > 0) return false;
        const details = $from.node(-1);
        const start = $from.before(-1);
        const body: PMNode[] = [];
        details.forEach((c, _o, i) => { if (i > 0) body.push(c); });
        const tr = editor.state.tr.replaceWith(start, start + details.nodeSize, Fragment.from(body));
        editor.view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(start + 1))).scrollIntoView());
        return true;
      },
    };
  },
});

/** Everything the editor needs for these blocks. */
export const QuoteBlocks = [QuoteSource, Pullquote, Callout, DetailsSummary, Details];

// ---------- "/" menu ----------
const svg = (d: string) => `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const blockIcons = {
  source: svg('<path d="M3 3.5v6M6.5 4.5h6.5M6.5 7h6.5M8.5 12h4.5M6.3 12h.6"/>'),
  pull: svg('<path d="M2.5 3.5h11M2.5 12.5h11M5 8h6"/>'),
  callout: svg('<rect x="2" y="3" width="12" height="10" rx="2.5"/><path d="M5 6.5h6M5 9.5h4"/>'),
  toggle: svg('<path d="m3 5 2 1.8L3 8.6"/><path d="M7.5 6.8h6M7.5 11h6"/>'),
};

/** The current textblock's range and inline content (after the "/query" is deleted). */
function currentBlock(e: Editor) {
  const { $from } = e.state.selection;
  return { from: $from.before(), to: $from.after(), node: $from.parent };
}

function insertQuoteWithSource(e: Editor) {
  const { state } = e;
  const { schema } = state;
  const { $from } = state.selection;
  const p = schema.nodes.paragraph;
  // Already in a quote: add a source line at its end.
  for (let d = $from.depth - 1; d > 0; d--) {
    if ($from.node(d).type.name !== 'blockquote') continue;
    const end = $from.end(d);
    const tr = state.tr.insert(end, p.create(null, schema.text('— ')));
    e.view.dispatch(tr.setSelection(TextSelection.create(tr.doc, end + 3)).scrollIntoView());
    e.view.focus();
    return;
  }
  const { from, to, node } = currentBlock(e);
  const inline = node.type.name === 'paragraph' || node.type.name === 'heading' ? node.content : Fragment.empty;
  const quote = schema.nodes.blockquote.create(null, [p.create(null, inline), p.create(null, schema.text('— '))]);
  const tr = state.tr.replaceWith(from, to, quote);
  e.view.dispatch(tr.setSelection(TextSelection.create(tr.doc, from + 2 + inline.size)).scrollIntoView());
  e.view.focus();
}

function insertToggle(e: Editor) {
  const { state } = e;
  const { schema } = state;
  const { from, to, node } = currentBlock(e);
  const title = node.textContent;
  const details = schema.nodes.details.create(null, [
    schema.nodes.detailsSummary.create(null, title ? schema.text(title) : null),
    schema.nodes.paragraph.create(),
  ]);
  const tr = state.tr.replaceWith(from, to, details);
  // caret: end of the title when empty or when it came from the line, so you type the title first
  e.view.dispatch(tr.setSelection(TextSelection.create(tr.doc, from + 2 + title.length)).scrollIntoView());
  e.view.focus();
}

/** Slash items for these blocks (slash.ts places them after "Quote"). */
export function blockSlashItems(blk: (e: Editor, r: Range) => ReturnType<Editor['chain']>): SlashItem[] {
  return [
    { id: 'quote-source', title: 'Quote with source', hint: '> … —', keywords: 'blockquote citation attribution author cite who said', icon: blockIcons.source, run: (e, r) => { blk(e, r).run(); insertQuoteWithSource(e); } },
    { id: 'pullquote', title: 'Pull quote', hint: 'big', keywords: 'pullquote highlight large centered emphasis', icon: blockIcons.pull, run: (e, r) => blk(e, r).setNode('paragraph').wrapIn('pullquote').run() },
    { id: 'callout', title: 'Callout', hint: 'note', keywords: 'note box aside tip info admonition', icon: blockIcons.callout, run: (e, r) => blk(e, r).setNode('paragraph').wrapIn('callout').run() },
    { id: 'toggle', title: 'Toggle', hint: '▸', keywords: 'details summary collapsible collapse expand fold accordion spoiler', icon: blockIcons.toggle, run: (e, r) => { blk(e, r).run(); insertToggle(e); } },
  ];
}
