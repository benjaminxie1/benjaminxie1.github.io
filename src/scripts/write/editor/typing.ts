// Writer conveniences: em dashes from "--" / "---", markdown-aware paste, cleaner
// paste from Google Docs/Word, and the same smart punctuation in plain text fields.
import { Extension, InputRule } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { DOMParser as PMDOMParser } from '@tiptap/pm/model';
import { markdownToHtml } from '../markdown';

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
    ];
  },
});

/** Plain text that's clearly markdown (headings, lists, quotes, bold, links, fences). */
export function looksLikeMarkdown(text: string): boolean {
  return /^(#{1,6} |> |[-*+] |\d+[.)] |```|---\s*$)/m.test(text) || /\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^)\s]+\)/.test(text);
}

export const SmartPaste = Extension.create({
  name: 'smartPaste',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          // Google Docs / Word / Notion: map heading levels onto the post's H2/H3.
          transformPastedHTML(html) {
            return html
              .replace(/<(\/?)h1(\s|>)/gi, '<$1h2$2')
              .replace(/<(\/?)h[4-6](\s|>)/gi, '<$1h3$2');
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
 * Smart punctuation for plain <textarea>/<input> fields (title, summary):
 * "--"/"---" → —, "..." → …, straight quotes → curly. Runs only on typed characters.
 */
export function smartPunctuation(el: HTMLTextAreaElement | HTMLInputElement) {
  el.addEventListener('input', (e) => {
    const ev = e as InputEvent;
    if (ev.inputType !== 'insertText' || !ev.data) return;
    const pos = el.selectionStart ?? el.value.length;
    if (pos !== el.selectionEnd) return;
    const before = el.value.slice(0, pos);
    const after = el.value.slice(pos);
    let next: string | null = null;
    if (/—-$/.test(before)) next = before.slice(0, -2) + '—';
    else if (/--$/.test(before)) next = before.slice(0, -2) + '—';
    else if (/\.\.\.$/.test(before)) next = before.slice(0, -3) + '…';
    else if (ev.data === '"' || ev.data === "'") {
      const prev = before.slice(-2, -1);
      const open = prev === '' || /[\s([{—–-]/.test(prev);
      const ch = ev.data === '"' ? (open ? '“' : '”') : (open ? '‘' : '’');
      next = before.slice(0, -1) + ch;
    }
    if (next == null) return;
    el.value = next + after;
    el.setSelectionRange(next.length, next.length);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
