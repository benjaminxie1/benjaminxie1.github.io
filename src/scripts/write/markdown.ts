// Markdown <-> editor HTML, plus frontmatter, for the /write editor.
//
// Editor HTML contract (see CONTRACT.md): p, h2, h3, blockquote, ul/ol/li, hr,
// strong, em, s, code, a[href][title], br, pre > code.language-x, and block
// image figures: <figure><img src="/blog/x.webp" alt="a"><figcaption>cap</figcaption></figure>
// whose markdown form is ![a](/blog/x.webp "cap").
import TurndownService from 'turndown';
// @ts-ignore: no types shipped
import { strikethrough } from 'turndown-plugin-gfm';
import { Marked, type Tokens } from 'marked';
import YAML from 'yaml';
import { type Doc, today, toSite } from './lib';
import { embedTurndownRule, canonicalizeEmbeds, stripEmbeds } from './markdown-embed';
import { addBlockRules, withoutKnownBlocks } from './markdown-blocks';
import { footnoteRule, withFootnotesMd, withFootnotesHtml, stripFootnoteRefs } from './markdown-footnotes';
import { addImageRules, figureHtml, galleryHtml, sizeFragment, sizeOfClass, withoutGalleries } from './markdown-images';

/** Thrown by toMarkdown when the HTML still references a local (blob:/data:) image. */
export class UnsavedImageError extends Error {
  constructor() { super('An image is still uploading (or failed to upload). Wait for it to finish, or remove it, then save again.'); this.name = 'UnsavedImageError'; }
}
/** Thrown by parseMarkdown when the frontmatter isn't valid YAML. */
export class FrontmatterError extends Error {
  constructor(detail: string) { super(`This post's settings block (frontmatter) couldn't be read: ${detail}`); this.name = 'FrontmatterError'; }
}

// ---------- image src policy ----------
/** Site path for an image src. Maps raw/github URLs back to /blog/…; refuses local blob:/data: URLs. */
export function siteSrc(src: string): string {
  const s = (src || '').trim();
  if (/^(blob|data|filesystem):/i.test(s)) throw new UnsavedImageError();
  return toSite(s);
}

// ---------- HTML -> markdown ----------
const esc = {
  alt: (s: string) => s.replace(/\s+/g, ' ').trim().replace(/([\\\[\]])/g, '\\$1'),
  title: (s: string) => s.replace(/\s+/g, ' ').trim().replace(/(["\\])/g, '\\$1'),
  url: (s: string) => {
    const u = s.trim().replace(/ /g, '%20');
    // balanced parens are fine in CommonMark, but escaping is always safe
    return u.replace(/([()<>\\])/g, '\\$1');
  },
};
const td = new TurndownService({
  headingStyle: 'atx', bulletListMarker: '-', hr: '---', emDelimiter: '*', strongDelimiter: '**',
  codeBlockStyle: 'fenced', fence: '```', br: '\\',
});
td.use(strikethrough);
// Escape what could turn typed text into HTML: '<' before a tag-ish char, and '&' that looks like an entity.
const baseEscape = td.escape.bind(td);
td.escape = (s: string) => baseEscape(s)
  .replace(/&(?=#?[a-z0-9]+;)/gi, '&amp;')
  .replace(/<(?=[a-z/!?])/gi, '&lt;');

/** `frag` is a layout fragment (#wide, #row… see markdown-images.ts), appended to the src. */
function imageMd(img: Element, caption: string, frag = '') {
  const src = siteSrc(img.getAttribute('src') || '');
  const alt = esc.alt(img.getAttribute('alt') || '');
  const cap = caption.trim() ? ` "${esc.title(caption)}"` : '';
  return `![${alt}](${esc.url(src)}${frag}${cap})`;
}
td.addRule('figure', {
  filter: 'figure',
  replacement: (_c, node) => {
    const el = node as HTMLElement;
    const img = el.querySelector('img');
    if (!img) return '\n\n' + td.turndown(el.innerHTML) + '\n\n';
    const cap = el.querySelector('figcaption')?.textContent || img.getAttribute('title') || '';
    return '\n\n' + imageMd(img, cap, sizeFragment(sizeOfClass(el))) + '\n\n';
  },
});
addImageRules(td, imageMd); // side-by-side galleries
td.addRule('img', {
  filter: 'img',
  replacement: (_c, node) => {
    const el = node as HTMLElement;
    // An image inside running text: emit it as its own block (the editor only has block figures).
    const md = imageMd(el, el.getAttribute('title') || '');
    const inPara = !!el.closest('p,h1,h2,h3,h4,li,blockquote');
    return inPara ? md : '\n\n' + md + '\n\n';
  },
});
td.addRule('link', {
  filter: (node) => node.nodeName === 'A' && !!node.getAttribute('href'),
  replacement: (content, node) => {
    const el = node as HTMLElement;
    const href = el.getAttribute('href')!;
    if (/^(blob|data):/i.test(href)) return content;
    const title = el.getAttribute('title');
    const t = title ? ` "${esc.title(title)}"` : '';
    return `[${content}](${esc.url(toSite(href))}${t})`;
  },
});
// Code blocks: language from pre > code.language-x (or pre[data-language]); trailing newline normalised.
td.addRule('codeBlock', {
  filter: (node) => node.nodeName === 'PRE',
  replacement: (_c, node) => {
    const pre = node as HTMLElement;
    const code = pre.querySelector('code');
    const cls = (code?.getAttribute('class') || '') + ' ' + (pre.getAttribute('class') || '');
    const lang = (cls.match(/(?:^|\s)language-([\w+#.-]+)/) || [])[1] || pre.getAttribute('data-language') || '';
    const text = (code || pre).textContent!.replace(/\n$/, '');
    const runs = text.match(/`{3,}/g) || [];
    const fence = '`'.repeat(Math.max(3, ...runs.map((r) => r.length + 1)));
    return `\n\n${fence}${lang}\n${text}\n${fence}\n\n`;
  },
});

// Lists: tight unless an item really has several blocks (paragraphs, code…), which then round-trip.
const BLOCK = new Set(['P', 'PRE', 'BLOCKQUOTE', 'FIGURE', 'H2', 'H3', 'H4', 'HR']);
const multiBlock = (li: Element) => Array.from(li.children).filter((c) => BLOCK.has(c.nodeName)).length > 1 || !!li.querySelector(':scope > pre');
const looseTree = (el: Element) => (el.nodeName === 'LI' && multiBlock(el)) || Array.from(el.querySelectorAll('li')).some(multiBlock);
td.addRule('list', {
  filter: ['ul', 'ol'],
  replacement: (content, node) => {
    const parent = node.parentNode as HTMLElement | null;
    const body = content.replace(/^\n+|\n+$/g, '');
    if (parent && parent.nodeName === 'LI') return '\n\n' + body + '\n\n';
    return '\n\n' + body + '\n\n';
  },
});
td.addRule('listItem', {
  filter: 'li',
  replacement: (content, node) => {
    const li = node as HTMLElement;
    const parent = li.parentNode as HTMLElement;
    const ordered = parent.nodeName === 'OL';
    const items = Array.from(parent.children).filter((c) => c.nodeName === 'LI');
    const idx = items.indexOf(li);
    const prefix = ordered ? `${(Number(parent.getAttribute('start')) || 1) + idx}. ` : '- ';
    const loose = looseTree(li);
    let body = content.replace(/^\n+|\n+$/g, '');
    body = loose ? body.replace(/\n{3,}/g, '\n\n') : body.replace(/\n{2,}/g, '\n');
    const pad = ' '.repeat(prefix.length);
    body = body.split('\n').map((l, i) => (i === 0 || l === '' ? l : pad + l)).join('\n');
    const last = idx === items.length - 1;
    const listLoose = items.some((i) => looseTree(i));
    return prefix + body + (last ? '' : listLoose ? '\n\n' : '\n');
  },
});
footnoteRule(td); // before keep(): footnote refs are <sup data-footnote>
td.keep(['sub', 'sup']);
td.addRule('embed', embedTurndownRule); // video embeds: see markdown-embed.ts
addBlockRules(td); // pull quote, callout, toggle

/** HTML → markdown body (no frontmatter). Throws UnsavedImageError on blob:/data: images. */
export function htmlToMarkdown(html: string): string {
  return withFootnotesMd(() => td.turndown(html || '').replace(/\n{3,}/g, '\n\n').trim());
}

// ---------- markdown -> HTML ----------
const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const text = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const figure = figureHtml; // layout fragments (#wide…) → figure size classes; see markdown-images.ts
const isBlank = (t: Tokens.Generic) => (t.type === 'text' && !String(t.raw).trim()) || t.type === 'br';

const md = new Marked({ gfm: true, breaks: false });
md.use({
  renderer: {
    image({ href, title, text: alt }: Tokens.Image) { return figure(href, alt, title); },
    paragraph(this: any, tok: Tokens.Paragraph) {
      const toks = tok.tokens || [];
      if (!toks.some((t) => t.type === 'image')) return `<p>${this.parser.parseInline(toks)}</p>\n`;
      const row = galleryHtml(toks, (t) => this.parser.parseInline(t));
      if (row) return row;
      // split around images: text runs become paragraphs, images become figures
      let out = '', run: Tokens.Generic[] = [];
      const flush = () => {
        while (run.length && isBlank(run[0])) run.shift();
        while (run.length && isBlank(run[run.length - 1])) run.pop();
        if (run.length) {
          // trim the whitespace/newline that separated the run from the image
          const html = this.parser.parseInline(run).trim();
          if (html) out += `<p>${html}</p>\n`;
        }
        run = [];
      };
      for (const t of toks) {
        if (t.type === 'image') { flush(); out += figure(t.href, t.text, t.title) + '\n'; }
        else run.push(t);
      }
      flush();
      return out;
    },
    code({ text: code, lang }: Tokens.Code) {
      const l = (lang || '').match(/^[\w+#.-]+/)?.[0];
      return `<pre><code${l ? ` class="language-${attr(l)}"` : ''}>${text(code.replace(/\n$/, ''))}</code></pre>\n`;
    },
  },
});

/** Markdown body → editor HTML. */
export function markdownToHtml(body: string): string {
  return canonicalizeEmbeds(withFootnotesHtml(body || '', (b) => md.parse(b, { async: false }) as string));
}

/** Things in this HTML that the editor can't represent (and would be lost on save). */
export function unsupportedIn(html: string): string[] {
  html = stripEmbeds(html); // allowlisted video embeds are supported
  const found = new Set<string>();
  html = stripFootnoteRefs(html); // footnotes are supported
  const checks: Array<[RegExp, string]> = [
    [/<table[\s>]/i, 'a table'], [/<(iframe|video|audio|embed|object)[\s>]/i, 'an embed (video/iframe)'],
    [/<(div|span|section|details|aside)[\s>]/i, 'raw HTML'], [/<script[\s>]/i, 'a script'],
    [/<h1[\s>]/i, 'a top-level heading (# …)'], [/<(h4|h5|h6)[\s>]/i, 'a small heading (#### …)'],
    [/<input[^>]+checkbox/i, 'a task list'], [/<(sup|sub)[\s>]/i, 'super/subscript'],
  ];
  const rest = withoutKnownBlocks(withoutGalleries(html)); // pull quotes, callouts and toggles are fine
  for (const [re, label] of checks) if (re.test(rest)) found.add(label);
  return [...found];
}

// ---------- frontmatter ----------
const KNOWN = ['title', 'description', 'date', 'cover', 'draft'];
const pad = (n: number) => String(n).padStart(2, '0');
/** 'YYYY-MM-DD' for anything Date-like, or null if it can't be read. Timestamps use UTC, like the site. */
export function normaliseDate(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date) return isNaN(+raw) ? null : raw.toISOString().slice(0, 10);
  const s = String(raw).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? s : null;
  }
  if (/^\d+$/.test(s)) return null; // bare numbers aren't dates
  const d = new Date(s);
  if (isNaN(+d)) return null;
  if (/[T:]/.test(s)) return d.toISOString().slice(0, 10);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const q = (s: string) => JSON.stringify(s); // JSON strings are valid YAML double-quoted scalars
const safeBare = (s: string) => /^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(s);

export function toMarkdown(doc: Doc): string {
  const body = htmlToMarkdown(doc.html); // first: may throw UnsavedImageError
  let date: string;
  if (doc.dateRaw != null && (doc.date === doc.dateRaw || doc.date === normaliseDate(doc.dateRaw))) date = doc.dateRaw;
  else date = doc.date || today();
  const cover = doc.cover ? siteSrc(doc.cover) : '';
  const lines = [
    '---',
    `title: ${q((doc.title || '').trim())}`,
    `description: ${q((doc.description || '').trim())}`,
    `date: ${safeBare(date) ? date : q(date)}`,
    ...(cover ? [`cover: ${q(cover)}`] : []),
    `draft: ${doc.draft === true}`,
  ];
  const extra = doc.extra || {};
  for (const k of Object.keys(extra)) {
    if (KNOWN.includes(k)) continue;
    lines.push(YAML.stringify({ [k]: extra[k] }, { lineWidth: 0 }).replace(/\n$/, ''));
  }
  lines.push('---', '');
  return lines.join('\n') + '\n' + body + '\n';
}

export function splitFrontmatter(text: string): { fm: string | null; body: string } {
  const t = text.replace(/^\uFEFF/, '');
  const m = t.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n?---[ \t]*(?:\r?\n|$)/);
  return m ? { fm: m[1], body: t.slice(m[0].length) } : { fm: null, body: t };
}

export function parseMarkdown(text: string, path: string | null, sha: string | null): Doc {
  const { fm, body } = splitFrontmatter(text);
  let meta: Record<string, unknown> = {};
  if (fm != null && fm.trim()) {
    const parsed = YAML.parseDocument(fm, { schema: 'core', prettyErrors: true });
    if (parsed.errors.length) throw new FrontmatterError(parsed.errors[0].message.split('\n')[0]);
    const v = parsed.toJS();
    if (v && typeof v === 'object' && !Array.isArray(v)) meta = v as Record<string, unknown>;
    else if (v != null) throw new FrontmatterError('expected “key: value” lines');
  }
  const extra: Record<string, unknown> = {};
  for (const k of Object.keys(meta)) if (!KNOWN.includes(k)) extra[k] = meta[k];
  const str = (v: unknown) => (v == null ? '' : typeof v === 'string' ? v : String(v));
  const rawDate = meta.date == null || meta.date === '' ? undefined : meta.date instanceof Date ? meta.date.toISOString() : String(meta.date);
  // match the site's schema: absent → published; anything other than literal false → draft
  const draft = meta.draft == null ? false : meta.draft !== false;
  const doc: Doc = {
    path, sha,
    title: str(meta.title),
    description: str(meta.description),
    date: rawDate === undefined ? today() : normaliseDate(rawDate) ?? rawDate,
    cover: meta.cover ? toSite(str(meta.cover)) : '',
    draft,
    published: !!path && !draft,
    html: markdownToHtml(body),
  };
  if (rawDate !== undefined) doc.dateRaw = rawDate;
  if (Object.keys(extra).length) doc.extra = extra;
  return doc;
}
