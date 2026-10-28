// Markdown <-> editor HTML, plus frontmatter, for the /write editor.
import TurndownService from 'turndown';
import { marked } from 'marked';
import { type Doc, today, toDisplay, toSite } from './lib';

// ---------- markdown ----------
const td = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', hr: '---', emDelimiter: '*', codeBlockStyle: 'fenced' });
td.addRule('img', {
  filter: 'img',
  replacement: (_c, node) => {
    const el = node as HTMLImageElement;
    return `![${(el.getAttribute('alt') || '').replace(/[\[\]]/g, '')}](${toSite(el.getAttribute('src') || '')})`;
  },
});
// tight lists: "- item" per line (ProseMirror wraps list items in <p>)
td.addRule('li', {
  filter: 'li',
  replacement: (content, node) => {
    const parent = node.parentNode as HTMLElement;
    const ordered = parent.nodeName === 'OL';
    const idx = Array.prototype.indexOf.call(parent.children, node);
    const prefix = ordered ? `${(Number(parent.getAttribute('start')) || 1) + idx}. ` : '- ';
    const body = content.replace(/\n{2,}/g, '\n').trim().replace(/\n/g, '\n' + ' '.repeat(prefix.length));
    return prefix + body + (node.nextSibling ? '\n' : '');
  },
});
const q = (s: string) => JSON.stringify(s);
export function toMarkdown(doc: Doc): string {
  const fm = [
    '---',
    `title: ${q(doc.title.trim())}`,
    `description: ${q(doc.description.trim())}`,
    `date: ${doc.date}`,
    ...(doc.cover ? [`cover: ${q(doc.cover)}`] : []),
    `draft: ${doc.draft}`,
    '---',
    '',
  ].join('\n');
  return fm + td.turndown(doc.html).trim() + '\n';
}
export function parseMarkdown(text: string, path: string, sha: string): Doc {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const meta: Record<string, string | boolean> = {};
  if (m) {
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^(\w+):\s*(.*)$/);
      if (!kv) continue;
      let v: string | boolean = kv[2].trim();
      if (v.startsWith('"')) { try { v = JSON.parse(v); } catch {} }
      else if (v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1).replace(/''/g, "'");
      else if (v === 'true' || v === 'false') v = v === 'true';
      meta[kv[1]] = v;
    }
  }
  const body = m ? text.slice(m[0].length) : text;
  const html = (marked.parse(body, { async: false }) as string).replace(/src="(\/blog\/[^"]+)"/g, (_x, s) => `src="${toDisplay(s)}"`);
  const draft = meta.draft !== false;
  return {
    path, sha,
    title: String(meta.title ?? ''),
    description: String(meta.description ?? ''),
    date: String(meta.date ?? today()).slice(0, 10),
    cover: String(meta.cover ?? ''),
    draft, published: !draft, html,
  };
}

