// The writing surface (STUB: EDITOR workstream replaces this with the full experience).
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';

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
  let pending = 0;
  let silent = false;
  const editor = new Editor({
    element: opts.element,
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] }, underline: false, link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: null, target: null } } }),
      Image,
      Placeholder.configure({ placeholder: 'Start writing…' }),
    ],
    editorProps: { attributes: { class: 'body', spellcheck: 'true' } },
    onUpdate: () => { if (!silent) opts.onChange(); },
  });
  return {
    editor,
    getHTML: () => editor.getHTML(),
    setHTML(html) { silent = true; editor.commands.setContent(html || '', { emitUpdate: false }); silent = false; },
    isUploading: () => pending > 0,
    stats() {
      const words = (editor.getText().match(/\S+/g) || []).length;
      return { words, minutes: Math.max(1, Math.round(words / 230)) };
    },
    focusStart() { editor.view.focus(); editor.commands.setTextSelection(1); },
    openShortcuts() { opts.onMessage?.('Shortcuts: ⌘B bold, ⌘I italic, ## heading'); },
    destroy: () => editor.destroy(),
  };
}
