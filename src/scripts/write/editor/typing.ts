// Writer conveniences: em dashes from "--" / "---", markdown-aware paste, cleaner
// paste from Google Docs/Word, and the same smart punctuation in plain text fields.
import { Extension, InputRule, textblockTypeInputRule } from '@tiptap/core';
import { Plugin, TextSelection } from '@tiptap/pm/state';
import { liftListItem } from '@tiptap/pm/schema-list';
import { DOMParser as PMDOMParser } from '@tiptap/pm/model';
import { markdownToHtml } from '../markdown';
import { normalizeUrl } from './link';

/**
 * Typography already turns "--" into "—". This absorbs a third hyphen so "---" also
 * gives a single em dash mid-sentence. At the start of an empty line, "---" still makes
 * a divider (StarterKit's horizontal-rule rule matches "—-" there).
 */
export const Dashes = Extension.create({
  name: 'dashes',
  addInputRules() {
    return [
      new InputRule({
        find: /([^\n])—-$/,
        handler: ({ state, range, match }) => {
          state.tr.insertText('—', range.from + match[1].length, range.to);
        },
      }),
      // Number ranges take an en dash: "2019--2020" → 2019–2020, "pp. 10--12" → 10–12.
      new InputRule({
        find: /(\d)—(\d)$/,
        handler: ({ state, range, match }) => {
          state.tr.insertText('–', range.from + match[1].length, range.from + match[1].length + 1);
        },
      }),
      // An apostrophe before a number is a contraction, not an opening quote: '90s → ’90s.
      new InputRule({
        find: /(^|[\s([{“"—–])‘(\d)$/,
        handler: ({ state, range, match }) => {
          const at = range.from + match[1].length;
          state.tr.insertText('’', at, at + 1);
        },
      }),
    ];
  },
});

/**
 * Markdown habits the post schema (H2/H3 only) would otherwise ignore: "# " → heading,
 * "#### " (or deeper) → subheading, and an inline link typed as [text](url).
 */
export const MarkdownHabits = Extension.create({
  name: 'markdownHabits',
  priority: 1000, // its Backspace must run before the default join-with-the-line-above
  addInputRules() {
    const heading = this.editor.schema.nodes.heading;
    const link = this.editor.schema.marks.link;
    return [
      textblockTypeInputRule({ find: /^#\s$/, type: heading, getAttributes: { level: 2 } }),
      textblockTypeInputRule({ find: /^#{4,6}\s$/, type: heading, getAttributes: { level: 3 } }),
      new InputRule({
        find: /\[([^\[\]\n]+)\]\(([^()\s]+)\)$/,
        handler: ({ state, range, match }) => {
          const href = normalizeUrl(match[2]);
          if (!href || !link || !state.doc.resolve(range.from).parent.type.allowsMarkType(link)) return null;
          const { tr } = state;
          tr.replaceWith(range.from, range.to, state.schema.text(match[1], [link.create({ href })]));
          tr.removeStoredMark(link);
        },
      }),
    ];
  },
  addKeyboardShortcuts() {
    // Backspace at the very start of a heading, quote, list item, callout or pull quote
    // turns it back into a plain paragraph (Notion / Medium / Docs), instead of merging it
    // into the line above.
    const unwrap = () => {
      const { editor } = this;
      const { state, view } = editor;
      const sel = state.selection;
      if (!sel.empty || !(sel instanceof TextSelection)) return false;
      const { $from } = sel;
      if ($from.parentOffset !== 0) return false;
      if (editor.commands.undoInputRule()) return true;
      const parent = $from.parent;
      if (parent.type.name === 'heading') return editor.commands.setNode('paragraph');
      if (parent.type.name !== 'paragraph' || $from.depth < 2 || $from.index(-1) !== 0) return false;
      const wrapper = $from.node(-1).type.name;
      if (wrapper === 'listItem') return liftListItem(state.schema.nodes.listItem)(state, view.dispatch);
      if (wrapper === 'blockquote' || wrapper === 'callout' || wrapper === 'pullquote') return editor.commands.lift(wrapper);
      return false;
    };
    return {
      Backspace: unwrap,
      // Gmail / Substack spelling of strikethrough, alongside TipTap's Mod-Shift-s.
      'Mod-Shift-x': () => this.editor.commands.toggleStrike(),
    };
  },
});

/**
 * The first paragraph opens with a floated drop cap, which confuses Chrome's caret movement:
 * "start of line" (Home, ⌘←) lands after it, and End / ↓ from before it go astray.
 */
export const LineStartFix = Extension.create({
  name: 'lineStartFix',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleKeyDown(view, e) {
            // From the very start (before the drop cap) Chrome's End / ↓ / ⌘→ jump to the wrong
            // place. Step past the drop cap first, then let the browser move as usual.
            const forward = ['End', 'ArrowDown', 'PageDown'].includes(e.key) || (e.key === 'ArrowRight' && e.metaKey);
            if (forward && !e.ctrlKey && !e.altKey && view.state.selection.head === 1) {
              const firstP = view.state.doc.firstChild;
              if (!firstP || firstP.type.name !== 'paragraph' || firstP.content.size < 3) return false;
              const { anchor } = view.state.selection;
              // (one character further than the drop cap: right after it still counts as inside it)
              view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, e.shiftKey ? anchor : 3, 3)));
              const sel = view.dom.ownerDocument.getSelection() as Selection & { modify?: (a: string, d: string, g: string) => void };
              if (!sel?.modify) return false;
              sel.modify(e.shiftKey ? 'extend' : 'move', 'forward', e.key === 'ArrowDown' || e.key === 'PageDown' ? 'line' : 'lineboundary');
              return true;
            }
            const lineStart = (e.key === 'Home' && !e.metaKey && !e.ctrlKey && !e.altKey) || (e.key === 'ArrowLeft' && e.metaKey && !e.ctrlKey && !e.altKey);
            if (!lineStart) return false;
            const first = view.state.doc.firstChild;
            if (!first || first.type.name !== 'paragraph' || !first.content.size) return false;
            const { head, anchor } = view.state.selection;
            if (head < 2 || head > first.nodeSize - 1) return false;
            try {
              // only on the opening line (the one that starts beside the drop cap)
              const line = view.coordsAtPos(2, 1), here = view.coordsAtPos(head, -1);
              if (Math.abs(here.bottom - line.bottom) > 2) return false;
            } catch { return false; }
            view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, e.shiftKey ? anchor : 1, 1)).scrollIntoView());
            return true;
          },
        },
      }),
    ];
  },
});

/** Plain text that's clearly markdown (headings, lists, quotes, bold, links, fences). */
export function looksLikeMarkdown(text: string): boolean {
  return /^(#{1,6} |> |[-*+] |\d+[.)] |```|---\s*$)/m.test(text) || /\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^)\s]+\)/.test(text);
}

/**
 * Word pastes list items as <p style="mso-list:l0 level1"> with a typed "·" or "1." marker.
 * Turn runs of those into real (nested) <ul>/<ol> lists.
 */
export function wordLists(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const items = [...doc.body.querySelectorAll<HTMLElement>('p[style*="mso-list"], li[style*="mso-list"]')]
    .filter((el) => !/mso-list:\s*ignore/i.test(el.getAttribute('style') || ''));
  if (!items.length) return html;
  let stack: { list: HTMLElement; level: number }[] = [];
  let prev: Element | null = null;
  for (const el of items) {
    const style = el.getAttribute('style') || '';
    const level = Number(/level(\d+)/i.exec(style)?.[1] || 1);
    const marker = [...el.querySelectorAll<HTMLElement>('[style*="mso-list"]')].filter((m) => /mso-list:\s*ignore/i.test(m.getAttribute('style') || ''));
    const markText = marker.map((m) => m.textContent || '').join('').trim();
    marker.forEach((m) => m.remove());
    const ordered = /^(\d+|[a-z]|[ivxlc]+)[.)]/i.test(markText);
    // a new list unless this item directly follows the previous one
    if (!prev || el.previousElementSibling !== prev) stack = [];
    while (stack.length && stack[stack.length - 1].level > level) stack.pop();
    let top = stack[stack.length - 1];
    if (!top || top.level < level) {
      const list = doc.createElement(ordered ? 'ol' : 'ul');
      const parentLi = top?.list.lastElementChild;
      if (parentLi) parentLi.append(list); else el.before(list);
      stack.push((top = { list, level }));
    }
    const li = doc.createElement('li');
    // drop Word's conditional comments; without a marker span the bullet is plain text ("·  Item")
    const walker = doc.createTreeWalker(el, NodeFilter.SHOW_COMMENT | NodeFilter.SHOW_TEXT);
    const comments: Node[] = [];
    const texts: Text[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) (n.nodeType === 8 ? comments : texts).push(n as Text);
    comments.forEach((c) => c.parentNode?.removeChild(c));
    let bullet = !marker.length;
    for (const t of texts) {
      if (bullet) {
        const m = /^[\s\u00a0]*[·•▪§o-](?=[\s\u00a0]|$)/.exec(t.data);
        bullet = false;
        if (m) t.data = t.data.slice(m[0].length);
      }
      t.data = t.data.replace(/^[\s\u00a0]+/, '');
      if (t.data) break;
    }
    li.innerHTML = el.innerHTML;
    top.list.append(li);
    // keep a placeholder in the flow so the next item's previousElementSibling check works
    const mark = doc.createElement('template');
    el.replaceWith(mark);
    prev = mark;
  }
  doc.body.querySelectorAll('template').forEach((t) => t.remove());
  return doc.body.innerHTML;
}

export const SmartPaste = Extension.create({
  name: 'smartPaste',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          // Google Docs / Word / Notion: map heading levels onto the post's H2/H3.
          transformPastedHTML(html) {
            let out = html
              .replace(/<(\/?)h1(\s|>)/gi, '<$1h2$2')
              .replace(/<(\/?)h[4-6](\s|>)/gi, '<$1h3$2');
            // Google Docs adds a <br> after the last block (and between some): not a blank line you typed.
            if (/docs-internal-guid/.test(out)) out = out.replace(/(<\/(?:p|ul|ol|li|h[1-6]|table|blockquote|div)>)\s*<br\s*\/?>/gi, '$1');
            if (/mso-list/i.test(out)) out = wordLists(out);
            return out;
          },
          // Markdown pasted as plain text (from a .md file, notes app, or a chat) becomes formatted.
          handlePaste(view, event) {
            const data = event.clipboardData;
            if (!data || data.files?.length) return false;
            const html = data.getData('text/html');
            const text = data.getData('text/plain');
            if (!text || (html && html.trim())) return false;
            if (view.state.selection.$from.parent.type.spec.code) return false;
            if (!looksLikeMarkdown(text)) return false;
            let out: string;
            try { out = markdownToHtml(text); } catch { return false; }
            // parse in an inert document: nothing in pasted text can run
            const doc = new DOMParser().parseFromString(`<body>${out}</body>`, 'text/html');
            const slice = PMDOMParser.fromSchema(view.state.schema).parseSlice(doc.body);
            view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
            return true;
          },
        },
      }),
    ];
  },
});

/**
 * Smart punctuation for plain <textarea>/<input> fields (title, summary): the same rules as
 * the post body. "--"/"---" → —, 2019--2020 → 2019–2020, "..." → …, -> → →, straight
 * quotes → curly ('90s → ’90s). Runs only on typed characters, edits through the browser's
 * own undo stack (so ⌘Z works), and Backspace right after a replacement restores what was typed.
 */
export function smartPunctuation(el: HTMLTextAreaElement | HTMLInputElement, opts: { markdown?: boolean } = {}) {
  let last: { at: number; typed: string; made: string } | null = null;
  const replace = (from: number, to: number, text: string) => {
    el.setSelectionRange(from, to);
    // execCommand keeps native undo; fall back to setRangeText where it's unsupported.
    if (!document.execCommand('insertText', false, text)) {
      el.setRangeText(text, from, to, 'end');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  };
  let busy = false;
  el.addEventListener('input', (e) => {
    if (busy) return;
    const ev = e as InputEvent;
    if (ev.inputType !== 'insertText' || !ev.data) { last = null; return; }
    const pos = el.selectionStart ?? el.value.length;
    if (pos !== el.selectionEnd) return;
    const before = el.value.slice(0, pos);
    // never inside a web address, or (for markdown fields) a link target or `code`
    if (/(https?:\/\/|www\.)\S*$/i.test(before)) { last = null; return; }
    if (opts.markdown && (/\]\([^)\s]*$/.test(before) || (before.match(/`/g) || []).length % 2)) { last = null; return; }
    let m: [number, string, string] | null = null; // [chars to replace, replacement, what was typed]
    if (/—-$/.test(before)) m = [2, '—', '—-'];
    else if (/--$/.test(before)) m = [2, '—', '--'];
    else if (/\d—\d$/.test(before)) m = [2, '–' + before.slice(-1), before.slice(-2)];
    else if (/(^|[\s([{“"—–])‘\d$/.test(before)) m = [2, '’' + before.slice(-1), before.slice(-2)];
    else if (/\.\.\.$/.test(before)) m = [3, '…', '...'];
    else if (/->$/.test(before)) m = [2, '→', '->'];
    else if (/<-$/.test(before)) m = [2, '←', '<-'];
    else if (ev.data === '"' || ev.data === "'") {
      const prev = before.slice(-2, -1);
      const open = prev === '' || /[\s([{“‘—–-]/.test(prev);
      m = [1, ev.data === '"' ? (open ? '“' : '”') : (open ? '‘' : '’'), ev.data];
    }
    if (!m) { last = null; return; }
    busy = true;
    try { replace(pos - m[0], pos, m[1]); } finally { busy = false; }
    last = { at: pos - m[0] + m[1].length, typed: m[2], made: m[1] };
  });
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Backspace' || e.metaKey || e.ctrlKey || e.altKey || !last) return;
    const { at, typed, made } = last;
    last = null;
    if (el.selectionStart !== at || el.selectionEnd !== at || el.value.slice(at - made.length, at) !== made) return;
    e.preventDefault();
    busy = true;
    try { replace(at - made.length, at, typed); } finally { busy = false; }
  });
  el.addEventListener('blur', () => { last = null; });
}
