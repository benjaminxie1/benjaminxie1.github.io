// Selection bubble menu, the "+" button on empty lines, and the mobile formatting bar.
import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { h, icons, iconButton, isCompact, keepFocus } from './ui';

type Cmd = { id: string; icon: string; label: string; shortcut?: string; run: () => void; active?: () => boolean };

export function formatCommands(ed: () => Editor, link: () => void, image: () => void): Record<string, Cmd> {
  const c = () => ed().chain().focus();
  const editor = { isActive: (n: string, a?: Record<string, unknown>) => ed().isActive(n, a) };
  return {
    bold: { id: 'bold', icon: icons.bold, label: 'Bold', shortcut: 'Mod-b', run: () => c().toggleBold().run(), active: () => editor.isActive('bold') },
    italic: { id: 'italic', icon: icons.italic, label: 'Italic', shortcut: 'Mod-i', run: () => c().toggleItalic().run(), active: () => editor.isActive('italic') },
    strike: { id: 'strike', icon: icons.strike, label: 'Strikethrough', shortcut: 'Mod-Shift-s', run: () => c().toggleStrike().run(), active: () => editor.isActive('strike') },
    code: { id: 'code', icon: icons.code, label: 'Inline code', shortcut: 'Mod-e', run: () => c().toggleCode().run(), active: () => editor.isActive('code') },
    link: { id: 'link', icon: icons.link, label: 'Link', shortcut: 'Mod-k', run: link, active: () => editor.isActive('link') },
    h2: { id: 'h2', icon: icons.h2, label: 'Heading', shortcut: 'Mod-Alt-2', run: () => c().toggleHeading({ level: 2 }).run(), active: () => editor.isActive('heading', { level: 2 }) },
    h3: { id: 'h3', icon: icons.h3, label: 'Subheading', shortcut: 'Mod-Alt-3', run: () => c().toggleHeading({ level: 3 }).run(), active: () => editor.isActive('heading', { level: 3 }) },
    quote: { id: 'quote', icon: icons.quote, label: 'Quote', shortcut: 'Mod-Shift-b', run: () => c().toggleBlockquote().run(), active: () => editor.isActive('blockquote') },
    ul: { id: 'ul', icon: icons.ul, label: 'Bulleted list', shortcut: 'Mod-Shift-8', run: () => c().toggleBulletList().run(), active: () => editor.isActive('bulletList') },
    image: { id: 'image', icon: icons.image, label: 'Add image', run: image },
  };
}

function toolbar(cmds: Cmd[], cls: string, label: string, groups: number[] = []) {
  const el = h('div', { class: cls, role: 'toolbar', 'aria-label': label });
  const btns = new Map<string, HTMLButtonElement>();
  cmds.forEach((cmd, i) => {
    if (groups.includes(i)) el.append(h('span', { class: 'ed-sep', 'aria-hidden': 'true' }));
    const b = iconButton({ icon: cmd.icon, label: cmd.label, shortcut: cmd.shortcut, pressable: !!cmd.active, cls: `ed-cmd-${cmd.id}`, onClick: () => cmd.run() }) as HTMLButtonElement;
    btns.set(cmd.id, b);
    el.append(b);
  });
  keepFocus(el);
  // Roving arrow keys inside the toolbar; Esc returns to the text.
  el.addEventListener('keydown', (e) => {
    const list = [...btns.values()];
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      list[(i + (e.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length]?.focus();
    }
  });
  const sync = () => { for (const cmd of cmds) if (cmd.active) btns.get(cmd.id)!.setAttribute('aria-pressed', String(cmd.active())); };
  return { el, btns, sync };
}

export function createBubble(ed: () => Editor, cmds: Record<string, Cmd>) {
  const order = [cmds.bold, cmds.italic, cmds.strike, cmds.code, cmds.link, cmds.h2, cmds.h3, cmds.quote];
  const tb = toolbar(order, 'ed-pop ed-bubble', 'Format text', [4, 5]);
  tb.el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); ed().commands.focus(); } });
  return tb;
}

export function shouldShowBubble(editor: Editor, blocked: () => boolean) {
  return ({ state, from, to, view, element }: { state: Editor['state']; from: number; to: number; view: Editor['view']; element: HTMLElement }) => {
    if (blocked() || isCompact()) return false;
    if (!editor.isEditable) return false;
    if (!(view.hasFocus() || element.contains(document.activeElement))) return false;
    const sel = state.selection;
    if (sel.empty || sel instanceof NodeSelection) return false;
    if (!state.doc.textBetween(from, to).trim().length) return false;
    let code = false;
    state.doc.nodesBetween(from, to, (n) => { if (n.type.spec.code) code = true; });
    if (code) return false;
    return true;
  };
}

export function createPlus(onOpen: () => void) {
  const b = iconButton({ icon: icons.plus, label: 'Insert a block', cls: 'ed-plus', onClick: () => onOpen() });
  b.dataset.tip = 'Insert a block (or type /)';
  keepFocus(b);
  return b;
}

export function shouldShowPlus(editor: Editor, blocked: () => boolean) {
  return ({ state, view }: { state: Editor['state']; view: Editor['view'] }) => {
    if (blocked() || isCompact() || !view.hasFocus() || !editor.isEditable) return false;
    const { $from, empty } = state.selection;
    if (!empty) return false;
    const p = $from.parent;
    return $from.depth === 1 && p.type.name === 'paragraph' && p.content.size === 0;
  };
}

/** Mobile: one row of large buttons docked above the on-screen keyboard. */
export function createMobileBar(editor: Editor, cmds: Record<string, Cmd>) {
  const order = [cmds.bold, cmds.italic, cmds.h2, cmds.quote, cmds.ul, cmds.link, cmds.image];
  const tb = toolbar(order, 'ed-mbar-row', 'Formatting');
  const wrap = h('div', { class: 'ed-mbar', hidden: true }, tb.el);
  document.body.append(wrap);
  const vv = window.visualViewport;
  let raf = 0;
  const place = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const bottom = vv ? Math.max(0, window.innerHeight - (vv.offsetTop + vv.height)) : 0;
      wrap.style.transform = `translateY(${-bottom}px)`;
      const over = tb.el.scrollWidth > tb.el.clientWidth + 1;
      wrap.classList.toggle('can-scroll-right', over && tb.el.scrollLeft + tb.el.clientWidth < tb.el.scrollWidth - 1);
      wrap.classList.toggle('can-scroll-left', over && tb.el.scrollLeft > 1);
    });
  };
  tb.el.addEventListener('scroll', place, { passive: true });
  vv?.addEventListener('resize', place);
  vv?.addEventListener('scroll', place);
  window.addEventListener('resize', place);
  let hideTimer = 0;
  const update = () => {
    const want = isCompact() && (editor.isFocused || wrap.contains(document.activeElement));
    clearTimeout(hideTimer);
    if (want) {
      wrap.hidden = false;
      document.documentElement.classList.add('ed-mbar-on');
      tb.sync(); place();
    } else {
      // Small delay so tapping a bar button (which may blur briefly) doesn't flicker.
      hideTimer = window.setTimeout(() => { wrap.hidden = true; document.documentElement.classList.remove('ed-mbar-on'); }, 120);
    }
  };
  return {
    el: wrap,
    sync: () => { tb.sync(); },
    update,
    destroy() {
      clearTimeout(hideTimer);
      vv?.removeEventListener('resize', place);
      vv?.removeEventListener('scroll', place);
      window.removeEventListener('resize', place);
      wrap.remove();
      document.documentElement.classList.remove('ed-mbar-on');
    },
  };
}
