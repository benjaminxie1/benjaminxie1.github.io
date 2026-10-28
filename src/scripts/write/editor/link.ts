// Link UX: inline URL field (⌘K), link info bubble (URL · Edit · Open · Remove), URL normalisation.
import { Extension, getMarkRange, posToDOMRect, type Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Floater, h, icons, keyLabel } from './ui';

/** "example.com" → https://example.com; keeps mailto:, tel:, /paths, #anchors, http(s). null = unusable. */
export function normalizeUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^(javascript|data|vbscript):/i.test(s)) return null;
  if (/^(https?:\/\/|mailto:|tel:)/i.test(s)) return s;
  if (/^[/#?]/.test(s)) return s;
  if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(s)) return 'mailto:' + s;
  if (/^\/\//.test(s)) return 'https:' + s;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^[^:]+:\d/.test(s)) return null; // unknown scheme
  if (/\s/.test(s)) return null;
  return 'https://' + s;
}

const fakeSelKey = new PluginKey<DecorationSet>('edFakeSelection');
/** Keeps the selected text visibly highlighted while focus is in the URL field. */
export const FakeSelection = Extension.create({
  name: 'edFakeSelection',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: fakeSelKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            const meta = tr.getMeta(fakeSelKey);
            if (meta === null) return DecorationSet.empty;
            if (meta) return DecorationSet.create(tr.doc, [Decoration.inline(meta.from, meta.to, { class: 'ed-fake-sel' })]);
            return set.map(tr.mapping, tr.doc);
          },
        },
        props: { decorations: (s) => fakeSelKey.getState(s) },
      }),
    ];
  },
});

export type LinkUI = {
  openEditor(): void;
  isEditing(): boolean;
  refresh(): void;
  destroy(): void;
};

export function createLinkUI(editor: Editor, opts: { onMessage?: (m: string, k?: 'info' | 'error') => void; suppressed: () => boolean }): LinkUI {
  // ----- the URL field -----
  const input = h('input', { type: 'text', class: 'ed-link-input', placeholder: 'Paste or type a link…', 'aria-label': 'Link address', spellcheck: 'false', autocomplete: 'off', inputmode: 'url', enterkeyhint: 'done' });
  const apply = h('button', { type: 'button', class: 'ed-btn ed-text-btn ed-primary', 'aria-label': 'Apply link' }, 'Apply');
  const hint = h('span', { class: 'ed-link-hint', 'aria-hidden': 'true' }, '↵ apply · esc cancel');
  const form = h('form', { class: 'ed-pop ed-link-form', role: 'dialog', 'aria-label': 'Edit link' }, input, apply, hint);
  const field = new Floater(form, 'bottom', 10);
  let range: { from: number; to: number } | null = null;
  let editing = false;

  const linkRangeAt = (pos: number) => {
    const type = editor.schema.marks.link;
    const $pos = editor.state.doc.resolve(pos);
    return getMarkRange($pos, type) || (pos > 0 ? getMarkRange(editor.state.doc.resolve(pos), type) : undefined) || null;
  };

  function openEditor() {
    const { state } = editor;
    const { from, to, empty } = state.selection;
    let r: { from: number; to: number } = { from, to };
    let current = '';
    if (editor.isActive('link')) {
      const lr = linkRangeAt(from);
      if (lr && (empty || (lr.from <= from && lr.to >= to))) r = lr;
      current = editor.getAttributes('link').href || '';
    }
    range = r;
    editing = true;
    info.hide();
    editor.view.dispatch(editor.state.tr.setMeta(fakeSelKey, r.from === r.to ? null : r).setMeta('edBubble', 'hide'));
    input.value = current;
    input.removeAttribute('aria-invalid');
    field.show(() => rectOf(r), 'bottom');
    input.focus({ preventScroll: true }); input.select();
  }

  const rectOf = (r: { from: number; to: number }) => {
    try {
      const max = editor.state.doc.content.size;
      return posToDOMRect(editor.view, Math.min(r.from, max), Math.min(r.to, max));
    } catch { return null; }
  };

  function close(refocus = true) {
    if (!editing) return;
    editing = false;
    field.hide();
    if (!editor.isDestroyed) {
      editor.view.dispatch(editor.state.tr.setMeta(fakeSelKey, null));
      if (refocus && range) { editor.view.focus(); editor.chain().focus().setTextSelection(range).run(); }
    }
    range = null;
  }

  function commit() {
    if (!range) return close();
    const raw = input.value;
    const r = range;
    if (!raw.trim()) {
      editor.chain().focus().setTextSelection(r).extendMarkRange('link').unsetLink().run();
      editing = false; field.hide(); editor.view.dispatch(editor.state.tr.setMeta(fakeSelKey, null)); range = null;
      return;
    }
    const href = normalizeUrl(raw);
    if (!href) {
      input.setAttribute('aria-invalid', 'true');
      opts.onMessage?.("That doesn't look like a link", 'error');
      input.focus();
      return;
    }
    editing = false; field.hide();
    editor.view.dispatch(editor.state.tr.setMeta(fakeSelKey, null));
    range = null;
    editor.view.focus(); // synchronous, so the next keystroke lands in the text
    if (r.from === r.to) {
      // Nothing selected: insert the address itself as linked text.
      const text = raw.trim().replace(/^https?:\/\//, '');
      editor.chain().focus().setTextSelection(r.from).insertContent({ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] }).run();
    } else {
      editor.chain().focus().setTextSelection(r).extendMarkRange('link').setLink({ href }).setTextSelection(r.to).run();
    }
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); commit(); });
  apply.addEventListener('mousedown', (e) => e.preventDefault());
  apply.addEventListener('click', (e) => { e.preventDefault(); commit(); });
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  });
  input.addEventListener('input', () => input.removeAttribute('aria-invalid'));
  form.addEventListener('focusout', (e) => {
    const next = e.relatedTarget as Node | null;
    if (next && form.contains(next)) return;
    setTimeout(() => { if (editing && !form.contains(document.activeElement)) close(false); }, 0);
  });

  // ----- the info bubble shown on a link (caret inside it, or mouse hover) -----
  const url = h('a', { class: 'ed-link-url', target: '_blank', rel: 'noopener noreferrer', tabindex: '-1' });
  const btnEdit = h('button', { type: 'button', class: 'ed-btn ed-text-btn', 'data-tip': `Edit link (${keyLabel('Mod-k')})` }, 'Edit');
  const btnOpen = h('a', { class: 'ed-btn ed-text-btn', target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Open link in a new tab', html: 'Open ↗' });
  const btnRemove = h('button', { type: 'button', class: 'ed-btn ed-text-btn', 'aria-label': 'Remove link' }, 'Remove');
  const card = h('div', { class: 'ed-pop ed-link-card', role: 'toolbar', 'aria-label': 'Link' }, url, h('span', { class: 'ed-sep' }), btnEdit, btnOpen, btnRemove);
  const info = new Floater(card, 'bottom', 8);
  let infoRange: { from: number; to: number } | null = null;
  let hoverTimer = 0;
  let viaHover = false;

  const display = (href: string) => href.replace(/^mailto:/, '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
  function showInfo(r: { from: number; to: number }, hover: boolean) {
    const mark = editor.state.doc.nodeAt(r.from)?.marks.find((m) => m.type.name === 'link');
    const href = (mark?.attrs.href as string) || '';
    if (!href) return info.hide();
    if (info.open && infoRange && infoRange.from === r.from && infoRange.to === r.to) return;
    infoRange = r; viaHover = hover;
    url.textContent = display(href) || href;
    url.title = href;
    url.href = href; btnOpen.setAttribute('href', href);
    info.show(() => rectOf(r), 'bottom');
  }
  for (const b of [btnEdit, btnRemove]) b.addEventListener('mousedown', (e) => e.preventDefault());
  btnEdit.addEventListener('click', () => {
    if (infoRange) editor.chain().focus().setTextSelection(infoRange).run();
    openEditor();
  });
  btnRemove.addEventListener('click', () => {
    if (infoRange) editor.chain().focus().setTextSelection(infoRange).unsetLink().setTextSelection(infoRange.to).run();
    info.hide(); infoRange = null;
  });
  btnOpen.addEventListener('click', () => { info.hide(); });
  card.addEventListener('keydown', (e) => { if (e.key === 'Escape') { info.hide(); editor.commands.focus(); } });
  card.addEventListener('mouseenter', () => clearTimeout(hoverTimer));
  card.addEventListener('mouseleave', () => { if (viaHover) scheduleHide(); });

  function scheduleHide() {
    clearTimeout(hoverTimer);
    hoverTimer = window.setTimeout(() => { if (viaHover) { info.hide(); infoRange = null; refresh(); } }, 280);
  }

  function refresh() {
    if (editing || editor.isDestroyed) return;
    if (opts.suppressed()) return info.hide();
    const { selection } = editor.state;
    const inside = editor.isFocused || card.contains(document.activeElement);
    if (inside && editor.isActive('link')) {
      const r = linkRangeAt(selection.from);
      if (r && selection.from >= r.from && selection.to <= r.to) return showInfo(r, false);
    }
    if (!viaHover || !info.open) { info.hide(); infoRange = null; }
  }

  const dom = editor.view.dom;
  const onOver = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest?.('a');
    if (!a || !dom.contains(a) || editing || opts.suppressed()) return;
    clearTimeout(hoverTimer);
    hoverTimer = window.setTimeout(() => {
      try {
        const pos = editor.view.posAtDOM(a, 0);
        const r = linkRangeAt(pos + 0) || linkRangeAt(pos + 1);
        if (r) showInfo(r, true);
      } catch {}
    }, 350);
  };
  const onOut = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest?.('a');
    if (a && dom.contains(a)) { clearTimeout(hoverTimer); if (viaHover && info.open) scheduleHide(); }
  };
  dom.addEventListener('mouseover', onOver);
  dom.addEventListener('mouseout', onOut);
  // Plain click on a link inside the editor shouldn't navigate; ⌘-click opens it.
  const onClick = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest?.('a');
    if (!a || !dom.contains(a)) return;
    e.preventDefault();
    if (e.metaKey || e.ctrlKey) window.open(a.getAttribute('href') || '', '_blank', 'noopener');
  };
  dom.addEventListener('click', onClick);
  const onBlur = () => setTimeout(() => { if (!card.contains(document.activeElement) && !viaHover) { info.hide(); infoRange = null; } }, 0);
  editor.on('blur', onBlur);

  return {
    openEditor,
    isEditing: () => editing,
    refresh,
    destroy() {
      clearTimeout(hoverTimer);
      field.hide(); info.hide();
      dom.removeEventListener('mouseover', onOver);
      dom.removeEventListener('mouseout', onOut);
      dom.removeEventListener('click', onClick);
      editor.off('blur', onBlur);
    },
  };
}
