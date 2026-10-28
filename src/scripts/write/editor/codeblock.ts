// Code blocks (`pre > code.language-x`) with a small, optional language field.
import CodeBlock from '@tiptap/extension-code-block';
import type { Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import type { NodeView } from '@tiptap/pm/view';
import type { Editor } from '@tiptap/core';
import { h } from './ui';

class CodeView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private lang: HTMLInputElement;
  constructor(public node: PMNode, private editor: Editor, private getPos: () => number | undefined) {
    this.contentDOM = h('code');
    const pre = h('pre', {}, this.contentDOM);
    this.lang = h('input', { type: 'text', class: 'ed-code-lang', placeholder: 'language', 'aria-label': 'Code language', spellcheck: 'false', autocomplete: 'off', size: '10' });
    this.dom = h('div', { class: 'ed-code' }, pre, h('div', { class: 'ed-code-meta', contenteditable: 'false' }, this.lang));
    this.lang.addEventListener('input', () => {
      const v = this.lang.value.toLowerCase().replace(/[^a-z0-9+#._-]/g, '');
      if (v !== this.lang.value) this.lang.value = v;
      const p = this.getPos(); if (typeof p !== 'number') return;
      this.editor.view.dispatch(this.editor.state.tr.setNodeMarkup(p, undefined, { ...this.node.attrs, language: v || null }));
    });
    this.lang.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Escape' || (e.key === 'Tab' && !e.shiftKey)) {
        e.preventDefault();
        const p = this.getPos(); if (typeof p !== 'number') return;
        const { state, view } = this.editor;
        view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, p + 1 + this.node.content.size)));
        view.focus();
      }
    });
    this.sync();
  }
  private sync() {
    const l = (this.node.attrs.language as string) || '';
    this.contentDOM.className = l ? `language-${l}` : '';
    if (document.activeElement !== this.lang) this.lang.value = l;
    this.dom.classList.toggle('has-lang', !!l);
  }
  update(node: PMNode) {
    if (node.type !== this.node.type) return false;
    this.node = node; this.sync();
    return true;
  }
  stopEvent(e: Event) { return e.target === this.lang; }
  ignoreMutation(m: MutationRecord | { type: 'selection'; target: Node }) { return !this.contentDOM.contains(m.target); }
}

export const EdCodeBlock = CodeBlock.extend({
  addNodeView() {
    return ({ node, editor, getPos }) => new CodeView(node, editor, getPos as () => number | undefined);
  },
}).configure({ languageClassPrefix: 'language-', defaultLanguage: null, HTMLAttributes: {} });
