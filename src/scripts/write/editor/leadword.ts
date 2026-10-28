// The opening word after the drop cap is shown in accent italics, like on the site
// (src/pages/blog/[...slug].astro). Purely visual: a decoration, never saved.
import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const LeadWord = Extension.create({
  name: 'leadWord',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations(state) {
            const first = state.doc.firstChild;
            if (!first || first.type.name !== 'paragraph') return null;
            const text = first.firstChild;
            if (!text || !text.isText) return null;
            const m = /^(\S)([^\s.,;:!?—–-]*)/.exec(text.text || '');
            if (!m || !m[2]) return null;
            const from = 1 + m[1].length; // inside the paragraph, after the first letter
            return DecorationSet.create(state.doc, [Decoration.inline(from, from + m[2].length, { class: 'lead-word' })]);
          },
        },
      }),
    ];
  },
});
