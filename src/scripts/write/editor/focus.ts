// Focus mode (⌘.) and typewriter scrolling.
// Focus: the page chrome fades while you type and comes back when you move the mouse;
// paragraphs other than the one you're in are gently dimmed.
// Typewriter: the line you're typing on stays near the middle of the screen.
import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { reducedMotion } from './ui';

const key = new PluginKey<boolean>('edFocus');

export const FocusPlugin = Extension.create({
  name: 'edFocus',
  addProseMirrorPlugins() {
    return [new Plugin<boolean>({
      key,
      state: {
        init: () => false,
        apply: (tr, on) => { const m = tr.getMeta(key); return typeof m === 'boolean' ? m : on; },
      },
      props: {
        decorations(state) {
          if (!key.getState(state)) return null;
          const { $from } = state.selection;
          if ($from.depth < 1) return null;
          const start = $from.before(1);
          const node = state.doc.nodeAt(start);
          if (!node) return null;
          return DecorationSet.create(state.doc, [Decoration.node(start, start + node.nodeSize, { class: 'ed-current' })]);
        },
      },
    })];
  },
});

export function createFocus(editor: Editor, o: { onChange?: (s: { focus: boolean; typewriter: boolean }) => void } = {}) {
  let focus = false;
  let typewriter = false;
  const root = document.documentElement;
  let lastMove: { x: number; y: number } | null = null;

  const emit = () => o.onChange?.({ focus, typewriter });
  function setFocus(on: boolean) {
    focus = on;
    root.classList.toggle('is-focus', on);
    if (!on) root.classList.remove('is-typing');
    editor.view.dispatch(editor.state.tr.setMeta(key, on).setMeta('addToHistory', false));
    emit();
  }
  function setTypewriter(on: boolean) {
    typewriter = on;
    root.classList.toggle('is-typewriter', on);
    if (on) center();
    emit();
  }
  /** Keep the caret's line at about 45% of the viewport height. */
  function center() {
    if (!typewriter || !editor.isFocused) return;
    try {
      const c = editor.view.coordsAtPos(editor.state.selection.head);
      const target = window.innerHeight * 0.45;
      const d = c.top - target;
      if (Math.abs(d) > 6) window.scrollBy({ top: d, behavior: reducedMotion() ? 'auto' : 'smooth' });
    } catch {}
  }
  editor.on('transaction', ({ transaction }) => {
    if (!typewriter) return;
    if (transaction.docChanged || transaction.selectionSet) requestAnimationFrame(center);
  });

  // chrome fades while typing in focus mode; any real mouse movement brings it back
  const onKey = (e: KeyboardEvent) => {
    if (!focus || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!editor.view.dom.contains(e.target as Node) && !(e.target as HTMLElement)?.closest?.('.post .head')) return;
    if (e.key.length === 1 || e.key === 'Enter' || e.key === 'Backspace') root.classList.add('is-typing');
  };
  const onMove = (e: PointerEvent) => {
    if (!root.classList.contains('is-typing')) { lastMove = { x: e.clientX, y: e.clientY }; return; }
    if (lastMove && Math.hypot(e.clientX - lastMove.x, e.clientY - lastMove.y) < 12) return;
    lastMove = { x: e.clientX, y: e.clientY };
    root.classList.remove('is-typing');
  };
  const onFocusIn = (e: FocusEvent) => { if ((e.target as HTMLElement)?.closest?.('.wbar')) root.classList.remove('is-typing'); };
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('focusin', onFocusIn);

  return {
    get focus() { return focus; },
    get typewriter() { return typewriter; },
    setFocus,
    setTypewriter,
    toggleFocus: () => setFocus(!focus),
    destroy() {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('focusin', onFocusIn);
    },
  };
}
