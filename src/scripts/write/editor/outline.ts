// Outline: the post's headings (H2/H3), to see the shape of a long post and jump around.
// On wide screens it sits quietly in the left margin (once there are two headings);
// on narrow ones the app shows the same list in a dialog.
import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { h } from './ui';

export type Heading = { level: number; text: string; pos: number };

export function headings(editor: Editor): Heading[] {
  const out: Heading[] = [];
  editor.state.doc.forEach((node, pos) => {
    if (node.type.name === 'heading') out.push({ level: node.attrs.level, text: node.textContent.trim(), pos });
  });
  return out;
}

/** Scroll a heading to just under the top bar and put the caret at its end. */
export function jumpTo(editor: Editor, pos: number) {
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
  const dom = editor.view.nodeDOM(pos) as HTMLElement | null;
  editor.view.focus();
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos + node.nodeSize - 1)));
  if (dom?.getBoundingClientRect) {
    const bar = document.querySelector('.wbar')?.getBoundingClientRect().height || 0;
    window.scrollTo({ top: window.scrollY + dom.getBoundingClientRect().top - bar - 28, behavior: 'smooth' });
  }
}

const WIDE = '(min-width: 1180px)';

export function createOutline(editor: Editor, o: { enabled: () => boolean }) {
  const list = h('ol', { class: 'ed-outline-list' });
  const el = h('nav', { class: 'ed-outline', 'aria-label': 'Outline', hidden: true },
    h('p', { class: 'ed-outline-h' }, 'Outline'), list);
  document.body.append(el);
  const wide = matchMedia(WIDE);
  let items: Heading[] = [];
  let sig = '';
  let timer = 0;
  let raf = 0;

  function render() {
    items = headings(editor);
    const show = o.enabled() && wide.matches && items.length >= 2;
    el.hidden = !show;
    if (!show) { sig = ''; return; }
    const s = JSON.stringify(items.map((i) => [i.level, i.text]));
    if (s !== sig) {
      sig = s;
      list.replaceChildren(...items.map((it, i) => {
        const b = h('button', { type: 'button', class: 'ed-outline-item lv' + it.level, 'data-i': i, title: it.text || 'Untitled heading' }, it.text || 'Untitled heading');
        if (!it.text) b.classList.add('is-empty');
        b.addEventListener('click', () => jumpTo(editor, items[i].pos));
        return h('li', {}, b);
      }));
    }
    spot();
  }
  /** Highlight the section you're reading: the last heading above 40% of the viewport. */
  function spot() {
    if (el.hidden) return;
    const line = window.innerHeight * 0.4;
    let cur = -1;
    items.forEach((it, i) => {
      const dom = editor.view.nodeDOM(it.pos) as HTMLElement | null;
      if (dom?.getBoundingClientRect && dom.getBoundingClientRect().top <= line) cur = i;
    });
    list.querySelectorAll('.ed-outline-item').forEach((b, i) => b.classList.toggle('is-cur', i === cur));
  }
  const soon = () => { clearTimeout(timer); timer = window.setTimeout(render, 250); };
  const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(spot); };
  editor.on('update', soon);
  window.addEventListener('scroll', onScroll, { passive: true });
  wide.addEventListener?.('change', render);
  render();
  return {
    el,
    refresh: render,
    destroy() { editor.off('update', soon); window.removeEventListener('scroll', onScroll); wide.removeEventListener?.('change', render); el.remove(); },
  };
}
