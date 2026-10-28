// The writing surface: Ben types straight onto the post, styled by post.css.
// Everything in-text lives here: bubble menu, link field, "/" menu, figures, code blocks,
// shortcut sheet and the mobile formatting bar. See CONTRACT.md for the HTML it produces.
import { Editor, Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import { Placeholder, CharacterCount } from '@tiptap/extensions';
import Typography from '@tiptap/extension-typography';
import FileHandler from '@tiptap/extension-file-handler';
import BubbleMenu from '@tiptap/extension-bubble-menu';
import FloatingMenu from '@tiptap/extension-floating-menu';
import { EditorState } from '@tiptap/pm/state';
import '../../styles/write-editor.css';
import { Figure, Uploads, insertFiles, pickFiles, stripPending, IMAGE_TYPES } from './editor/figure';
import { EdCodeBlock } from './editor/codeblock';
import { QuoteBlocks } from './editor/blocks';
import { SlashMenu, slashItems, openSlash } from './editor/slash';
import { FakeSelection, createLinkUI, normalizeUrl } from './editor/link';
import { createBubble, createMobileBar, createPlus, formatCommands, shouldShowBubble, shouldShowPlus } from './editor/menus';
import { openShortcuts as openSheet, destroyShortcuts } from './editor/shortcuts';
import { isCompact } from './editor/ui';

export { normalizeUrl };

export type EditorHandle = {
  editor: Editor;
  getHTML(): string;
  setHTML(html: string): void;
  isUploading(): boolean;
  stats(): { words: number; minutes: number };
  focusStart(): void;
  openShortcuts(): void;
  destroy(): void;
};

export function createEditor(opts: {
  element: HTMLElement;
  onChange: () => void;
  upload: (file: File) => Promise<{ src: string; preview: string }>;
  onUploadsChange?: (pending: number) => void;
  onMessage?: (msg: string, kind?: 'info' | 'error') => void;
}): EditorHandle {
  // eslint-disable-next-line prefer-const
  let editor: Editor = undefined as unknown as Editor; // assigned below; plugin callbacks guard on it
  const uploads = new Uploads(opts.upload, (n) => opts.onUploadsChange?.(n), opts.onMessage);
  let link: ReturnType<typeof createLinkUI> | null = null;
  const editing = () => !!link?.isEditing();
  const chooseImages = async (ed: Editor) => {
    const pos = ed.state.selection.from;
    const files = await pickFiles(true);
    if (files.length) insertFiles(ed, uploads, files, Math.min(pos, ed.state.doc.content.size));
  };

  // Elements handed to the bubble/floating plugins (they attach them when shown).
  const getEditor = () => editor;
  const cmds = formatCommands(getEditor, () => link?.openEditor(), () => chooseImages(editor));
  const bubble = createBubble(getEditor, cmds);
  const plusEl = createPlus(() => openSlash(editor));

  const EditorKeys = Extension.create({
    name: 'edKeys',
    addKeyboardShortcuts() {
      return {
        'Mod-k': () => { link?.openEditor(); return true; },
        'Mod-/': () => { sheet(); return true; },
        // Standard "go to toolbar" key: jump into the bubble menu or the image toolbar.
        'Alt-F10': () => {
          const target = document.querySelector<HTMLElement>('.ed-bubble .ed-btn') || opts.element.querySelector<HTMLElement>('.ed-figure.is-selected .ed-fig-bar .ed-btn');
          if (!target || !target.isConnected) return false;
          target.focus();
          return true;
        },
      };
    },
  });

  editor = new Editor({
    element: opts.element,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        underline: false,
        link: false,
        codeBlock: false,
        dropcursor: { color: '#2f6b45', width: 2 },
      }),
      Link.extend({ inclusive: () => false }).configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: 'https',
        HTMLAttributes: { rel: null, target: null, class: null },
      }),
      EdCodeBlock,
      Figure.configure({ uploads }),
      ...QuoteBlocks,
      Typography.configure({
        // Only the typographer's essentials: smart quotes, em dash, ellipsis.
        multiplication: false, oneHalf: false, oneQuarter: false, threeQuarters: false,
        superscriptTwo: false, superscriptThree: false, plusMinus: false, notEqual: false,
        laquo: false, raquo: false, copyright: false, trademark: false, servicemark: false,
        registeredTrademark: false, leftArrow: false, rightArrow: false,
      }),
      Placeholder.configure({
        includeChildren: false,
        showOnlyCurrent: true,
        placeholder: ({ editor: ed, node }) => {
          if (node.type.name === 'heading') return node.attrs.level === 3 ? 'Subheading' : 'Heading';
          if (node.type.name !== 'paragraph') return '';
          if (ed.isEmpty) return 'Start writing… (type / for blocks)';
          return isCompact() ? '' : 'Type / for blocks · ## heading · - list';
        },
      }),
      CharacterCount,
      FakeSelection,
      SlashMenu.configure({ items: slashItems((ed) => chooseImages(ed)) }),
      FileHandler.configure({
        allowedMimeTypes: IMAGE_TYPES,
        onPaste: (ed, files) => insertFiles(ed, uploads, files),
        onDrop: (ed, files, pos) => insertFiles(ed, uploads, files, pos),
      }),
      BubbleMenu.configure({
        pluginKey: 'edBubble',
        element: bubble.el,
        updateDelay: 120,
        shouldShow: (p) => !!editor && shouldShowBubble(editor, editing)(p as never),
        options: { placement: 'top', offset: 10, flip: true, shift: { padding: 8 }, inline: true },
      }),
      FloatingMenu.configure({
        pluginKey: 'edPlus',
        element: plusEl,
        shouldShow: (p) => !!editor && shouldShowPlus(editor, editing)(p as never),
        options: { placement: 'left', offset: 14, flip: false, shift: false },
      }),
      EditorKeys,
    ],
    editorProps: {
      attributes: { class: 'body', spellcheck: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Post body', 'aria-expanded': 'false' },
    },
    onUpdate: () => opts.onChange(),
  });
  uploads.editor = editor;

  link = createLinkUI(editor, { onMessage: opts.onMessage, suppressed: () => false });
  const mbar = createMobileBar(editor, cmds);

  const sync = () => {
    bubble.sync();
    mbar.sync();
    link?.refresh();
  };
  editor.on('selectionUpdate', sync);
  editor.on('transaction', ({ transaction }) => { if (transaction.docChanged || transaction.storedMarksSet) sync(); });
  editor.on('focus', () => { mbar.update(); sync(); });
  editor.on('blur', () => mbar.update());
  const onMq = () => mbar.update();
  const mq = matchMedia('(max-width: 640px)');
  mq.addEventListener?.('change', onMq);

  // ⌘/ also works when focus isn't in the text (e.g. right after load).
  const onDocKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || !(e.metaKey || e.ctrlKey) || e.key !== '/') return;
    const t = e.target as HTMLElement;
    if (t && t.closest('input, textarea, [contenteditable="true"]') && !editor.view.dom.contains(t)) return;
    e.preventDefault();
    sheet();
  };
  document.addEventListener('keydown', onDocKey);

  function sheet() {
    const wasFocused = editor.isFocused;
    const sel = editor.state.selection;
    openSheet(() => { if (!editor.isDestroyed && (wasFocused || document.activeElement === document.body)) { editor.view.focus(); try { editor.commands.setTextSelection({ from: sel.from, to: sel.to }); } catch {} } });
  }

  return {
    editor,
    getHTML: () => stripPending(editor.getHTML()),
    setHTML(html: string) {
      editor.commands.setContent(html || '', { emitUpdate: false });
      // Fresh state = fresh undo history (setContent alone would let ⌘Z undo into the previous post).
      const s = editor.state;
      editor.view.updateState(EditorState.create({ doc: s.doc, plugins: s.plugins, selection: s.selection }));
      sync();
    },
    isUploading: () => uploads.pending() > 0,
    stats() {
      const text = editor.state.doc.textBetween(0, editor.state.doc.content.size, ' ', ' ');
      const words = (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) || []).length;
      return { words, minutes: words ? Math.max(1, Math.round(words / 230)) : 0 };
    },
    focusStart() {
      editor.view.focus();
      editor.commands.setTextSelection(1);
    },
    openShortcuts: sheet,
    destroy() {
      document.removeEventListener('keydown', onDocKey);
      mq.removeEventListener?.('change', onMq);
      link?.destroy();
      mbar.destroy();
      uploads.destroy();
      destroyShortcuts();
      editor.destroy();
      bubble.el.remove();
      plusEl.remove();
    },
  };
}
