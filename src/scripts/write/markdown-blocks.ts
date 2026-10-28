// Markdown forms for the quote & callout blocks (see editor/blocks.ts).
//   pull quote  <aside class="pullquote">\n\n…\n\n</aside>
//   callout     <aside class="callout">\n\n…markdown…\n\n</aside>
//   toggle      <details>\n<summary>Title</summary>\n\n…markdown…\n\n</details>
//   quote+source is a plain blockquote whose last paragraph starts with "—" (nothing special here,
//   except that an empty source line "—" is dropped).
// The blank lines matter: they let both the site (Sätteri) and marked parse markdown inside the HTML.
import type TurndownService from 'turndown';

const html = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ASIDES = ['pullquote', 'callout'];
const asideKind = (el: HTMLElement) => ASIDES.find((k) => el.classList.contains(k));

export function addBlockRules(td: TurndownService) {
  td.addRule('quoteAside', {
    filter: (node) => node.nodeName === 'ASIDE' && !!asideKind(node as HTMLElement),
    replacement: (content, node) => `\n\n<aside class="${asideKind(node as HTMLElement)}">\n\n${content.replace(/^\n+|\n+$/g, '')}\n\n</aside>\n\n`,
  });
  // The summary is written by the details rule (as escaped plain text: it sits inside an HTML block).
  td.addRule('summary', { filter: (node) => node.nodeName === 'SUMMARY' && node.parentNode?.nodeName === 'DETAILS', replacement: () => '' });
  td.addRule('details', {
    filter: 'details',
    replacement: (content, node) => {
      const sum = Array.from((node as HTMLElement).children).find((c) => c.nodeName === 'SUMMARY');
      const title = html((sum?.textContent || '').replace(/\s+/g, ' ').trim());
      return `\n\n<details>\n<summary>${title}</summary>\n\n${content.replace(/^\n+|\n+$/g, '')}\n\n</details>\n\n`;
    },
  });
  // Blockquotes with clean blank lines (">" rather than "> "), as in "> Ship it.\n>\n> — Paul Graham".
  td.addRule('blockquoteClean', {
    filter: 'blockquote',
    replacement: (content) => {
      const body = content.replace(/^\n+|\n+$/g, '').split('\n').map((l) => (l ? '> ' + l : '>')).join('\n');
      return '\n\n' + body + '\n\n';
    },
  });
  // An untouched "— " placeholder source line isn't worth saving.
  td.addRule('emptyQuoteSource', {
    filter: (node) => node.nodeName === 'P' && node.parentNode?.nodeName === 'BLOCKQUOTE' && !node.nextElementSibling && !!node.previousElementSibling && (node.textContent || '').trim() === '—',
    replacement: () => '',
  });
}

/** The HTML with these blocks' exact tags removed, so unsupportedIn() only sees other raw HTML. */
export function withoutKnownBlocks(s: string): string {
  return s
    .replace(/<aside class="(?:pullquote|callout)">/g, '')
    .replace(/<\/aside>/g, '')
    .replace(/<details(?: open(?:="")?)?>\s*<summary>/g, '')
    .replace(/<\/summary>/g, '')
    .replace(/<\/details>/g, '');
}
