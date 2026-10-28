// "/" insert menu: Heading, Subheading, Quote, lists, Image, Code block, Divider.
import { Extension, type Editor, type Range } from '@tiptap/core';
import Suggestion, { type SuggestionProps } from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import { h, icons } from './ui';
import { footnoteSlashItem } from './footnote';

export type SlashItem = { id: string; title: string; hint: string; keywords: string; icon: string; run: (editor: Editor, range: Range) => void };

export const slashKey = new PluginKey('edSlash');

export function slashItems(pickImages: (editor: Editor) => void): SlashItem[] {
  const blk = (e: Editor, r: Range) => e.chain().focus().deleteRange(r);
  return [
    { id: 'h2', title: 'Heading', hint: '##', keywords: 'h2 title section large', icon: icons.heading, run: (e, r) => blk(e, r).setNode('heading', { level: 2 }).run() },
    { id: 'h3', title: 'Subheading', hint: '###', keywords: 'h3 small heading', icon: icons.sub, run: (e, r) => blk(e, r).setNode('heading', { level: 3 }).run() },
    { id: 'quote', title: 'Quote', hint: '>', keywords: 'blockquote citation', icon: icons.quote, run: (e, r) => blk(e, r).setNode('paragraph').toggleBlockquote().run() },
    { id: 'ul', title: 'Bulleted list', hint: '-', keywords: 'bullet unordered ul points', icon: icons.ul, run: (e, r) => blk(e, r).setNode('paragraph').toggleBulletList().run() },
    { id: 'ol', title: 'Numbered list', hint: '1.', keywords: 'ordered ol numbers steps', icon: icons.ol, run: (e, r) => blk(e, r).setNode('paragraph').toggleOrderedList().run() },
    { id: 'image', title: 'Image', hint: 'drop', keywords: 'photo picture figure upload img', icon: icons.image, run: (e, r) => { blk(e, r).run(); pickImages(e); } },
    { id: 'code', title: 'Code block', hint: '```', keywords: 'pre snippet program', icon: icons.codeBlock, run: (e, r) => blk(e, r).setNode('codeBlock').run() },
    { id: 'hr', title: 'Divider', hint: '---', keywords: 'hr rule separator break line', icon: icons.hr, run: (e, r) => blk(e, r).setHorizontalRule().run() },
    footnoteSlashItem,
  ];
}

const filter = (items: SlashItem[], q: string) => {
  const s = q.toLowerCase().trim();
  if (!s) return items;
  return items
    .map((it) => {
      const t = it.title.toLowerCase();
      const score = t.startsWith(s) ? 3 : t.split(' ').some((w) => w.startsWith(s)) ? 2 : (it.keywords + ' ' + it.hint).toLowerCase().includes(s) ? 1 : 0;
      return { it, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.it);
};

export const SlashMenu = Extension.create<{ items: SlashItem[] }>({
  name: 'edSlash',
  addOptions: () => ({ items: [] }),
  addProseMirrorPlugins() {
    const all = this.options.items;
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        pluginKey: slashKey,
        char: '/',
        startOfLine: false,
        allowedPrefixes: [' '],
        allowSpaces: false,
        placement: 'bottom-start',
        offset: { mainAxis: 8 },
        decorationClass: 'ed-slash-query',
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          if ($from.parent.type.spec.code) return false;
          if ($from.parent.type.name === 'figure') return false;
          return true;
        },
        items: ({ query }) => filter(all, query),
        command: ({ editor, range, props }) => props.run(editor, range),
        render: () => {
          let props: SuggestionProps<SlashItem, SlashItem>;
          let active = 0;
          let unmount: (() => void) | null = null;
          const list = h('div', { class: 'ed-slash-list', role: 'listbox', id: 'ed-slash-list', 'aria-label': 'Insert block' });
          const empty = h('div', { class: 'ed-slash-empty' }, 'No matching blocks');
          const foot = h('div', { class: 'ed-slash-foot', 'aria-hidden': 'true' }, '↑↓ to choose · ↵ to insert · esc to close');
          const el = h('div', { class: 'ed-pop ed-slash' }, list, empty, foot);
          el.addEventListener('mousedown', (e) => e.preventDefault());
          const draw = () => {
            list.replaceChildren(
              ...props.items.map((it, i) => {
                const opt = h('div', { class: 'ed-slash-item', role: 'option', id: `ed-slash-${it.id}`, 'aria-selected': String(i === active) },
                  h('span', { class: 'ed-slash-icon', html: it.icon }),
                  h('span', { class: 'ed-slash-title' }, it.title),
                  h('kbd', { class: 'ed-slash-hint' }, it.hint));
                opt.addEventListener('mousemove', () => { if (active !== i) { active = i; mark(); } });
                opt.addEventListener('click', () => props.command(it));
                return opt;
              }),
            );
            empty.hidden = props.items.length > 0;
            mark();
          };
          const mark = () => {
            [...list.children].forEach((c, i) => c.setAttribute('aria-selected', String(i === active)));
            const cur = list.children[active] as HTMLElement | undefined;
            cur?.scrollIntoView({ block: 'nearest' });
            const dom = props.editor.view.dom;
            if (cur) dom.setAttribute('aria-activedescendant', cur.id); else dom.removeAttribute('aria-activedescendant');
          };
          return {
            onStart(p) {
              props = p; active = 0;
              const dom = p.editor.view.dom;
              dom.setAttribute('aria-controls', 'ed-slash-list');
              dom.setAttribute('aria-expanded', 'true');
              draw();
              unmount = p.mount(el);
            },
            onUpdate(p) { props = p; active = 0; draw(); },
            onKeyDown({ event }) {
              const n = props.items.length;
              if (event.key === 'ArrowDown') { if (n) { active = (active + 1) % n; mark(); } return true; }
              if (event.key === 'ArrowUp') { if (n) { active = (active - 1 + n) % n; mark(); } return true; }
              if (event.key === 'Enter' || event.key === 'Tab') {
                const it = props.items[active];
                if (it) { props.command(it); return true; }
                return event.key === 'Tab';
              }
              return false;
            },
            onExit(p) {
              unmount?.(); unmount = null;
              const dom = p.editor.view.dom;
              dom.removeAttribute('aria-activedescendant');
              dom.removeAttribute('aria-controls');
              dom.setAttribute('aria-expanded', 'false');
            },
          };
        },
      }),
    ];
  },
});

/** Open the slash menu at the cursor (used by the "+" button). */
export function openSlash(editor: Editor) {
  const { $from } = editor.state.selection;
  const before = $from.parent.textBetween(0, $from.parentOffset);
  const text = before === '' || before.endsWith(' ') ? '/' : ' /';
  editor.chain().focus().insertContent(text).run();
}
