// Footnotes / citations: GFM footnote markdown <-> the editor's footnote HTML.
//
//   markdown:    A claim.[^1]          …          [^1]: Smith, *Title*, 2026.
//   editor HTML: A claim.<sup data-footnote="Smith, *Title*, 2026." data-ref="1">1</sup>
//
// A note's text is kept as its (inline) markdown source, so *italic* and [links](…) in
// citations survive a round trip. On save, notes are renumbered 1, 2, 3… in document order
// and their definitions are appended at the end of the post (one line each). References that
// share a label (and text) stay one note, like on the site.
import type TurndownService from 'turndown';

/** Collapse a note to one clean line; escape `[^` so a note can't start another footnote. */
export function cleanNote(s: string): string {
  return (s || '').replace(/\s+/g, ' ').trim().replace(/(^|[^\\])\[\^/g, '$1\\[^');
}

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** `<sup data-footnote="…">n</sup>` — the footnote node's HTML (what the editor parses). */
export const footnoteHtml = (note: string, ref: string | null, n: number | string = '*') =>
  `<sup data-footnote="${attr(note)}"${ref ? ` data-ref="${attr(ref)}"` : ''}>${n}</sup>`;

// ---------- HTML -> markdown ----------
let order = new Map<string, number>();
let defs: string[] = [];

/** Adds the turndown rule for footnote refs. Call once on the shared TurndownService. */
export function footnoteRule(td: TurndownService) {
  td.addRule('footnote', {
    filter: (node) => node.nodeName === 'SUP' && (node as HTMLElement).hasAttribute('data-footnote'),
    replacement: (_c, node) => {
      const el = node as HTMLElement;
      const note = cleanNote(el.getAttribute('data-footnote') || '');
      if (!note) return ''; // an empty note isn't a footnote
      const key = (el.getAttribute('data-ref') || '') + '\u0000' + note;
      let n = order.get(key);
      if (!n) { defs.push(note); n = defs.length; order.set(key, n); }
      return `[^${n}]`;
    },
  });
}

/** Wraps one HTML → markdown conversion: refs become [^n], definitions go at the end. */
export function withFootnotesMd(convert: () => string): string {
  order = new Map(); defs = [];
  try {
    const body = convert();
    if (!defs.length) return body;
    return (body ? body + '\n\n' : '') + defs.map((d, i) => `[^${i + 1}]: ${d}`).join('\n');
  } finally { order = new Map(); defs = []; }
}

// ---------- markdown -> HTML ----------
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const DEF = /^ {0,3}\[\^([^\]\s]+)\]:[ \t]*(.*)$/;
const BLOCK_START = /^ {0,3}(#{1,6}\s|>|[-*+]\s|\d+[.)]\s|(`{3,}|~{3,})|([-*_])( *\3){2,} *$)/;
const PH = /(\d+)/g;
const norm = (label: string) => label.toLowerCase();

/**
 * Pulls GFM footnote definitions out of the markdown and swaps references for placeholders,
 * runs `render` (marked) on the rest, then puts footnote HTML where the placeholders were.
 */
export function withFootnotesHtml(body: string, render: (md: string) => string): string {
  const src = body || '';
  if (!src.includes('[^')) return render(src);
  const lines = src.split('\n');
  const notes = new Map<string, string>();
  const drop = new Set<number>();
  let fence: string | null = null;

  // pass 1: definitions (outside code fences), with their continuation lines
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (fence) { if (line.trim().startsWith(fence) && line.trim().replace(/[`~]/g, '') === '') fence = null; continue; }
    const f = line.match(FENCE);
    if (f) { fence = f[1]; continue; }
    const d = line.match(DEF);
    if (!d) continue;
    const parts = [d[2]];
    drop.add(i);
    let j = i + 1;
    while (j < lines.length) {
      const l = lines[j];
      if (!l.trim()) {
        // a blank line ends the note unless the next line is indented (another paragraph of it)
        let k = j; while (k < lines.length && !lines[k].trim()) k++;
        if (k < lines.length && /^( {4}|\t)/.test(lines[k])) { for (let x = j; x < k; x++) drop.add(x); j = k; continue; }
        break;
      }
      if (DEF.test(l) || (!/^\s/.test(l) && BLOCK_START.test(l))) break;
      parts.push(l.trim()); drop.add(j); j++;
    }
    const label = norm(d[1]);
    if (!notes.has(label)) notes.set(label, parts.join(' ').replace(/\s+/g, ' ').trim()); // first definition wins
    i = j - 1;
  }
  if (!notes.size) return render(src);

  // pass 2: references → placeholders (not in code fences or code spans, not escaped)
  const refs: string[] = [];
  fence = null;
  const kept: string[] = [];
  lines.forEach((line, i) => {
    if (drop.has(i)) return;
    if (fence) { if (line.trim().startsWith(fence) && line.trim().replace(/[`~]/g, '') === '') fence = null; kept.push(line); return; }
    const f = line.match(FENCE);
    if (f) { fence = f[1]; kept.push(line); return; }
    const out = outsideCode(line, (seg) => seg.replace(/(\\?)\[\^([^\]\s]+)\]/g, (m, bs, label) => {
      if (bs || !notes.has(norm(label))) return m;
      refs.push(norm(label));
      return `\uE000${refs.length - 1}\uE001`;
    }));
    kept.push(out);
  });

  // trailing blank lines left behind by removed definitions
  while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
  const html = render(kept.join('\n'));
  const num = new Map<string, number>();
  for (const r of refs) if (!num.has(r)) num.set(r, num.size + 1);
  return html.replace(PH, (_m, i) => {
    const label = refs[+i];
    return label === undefined ? '' : footnoteHtml(notes.get(label)!, label, num.get(label)!);
  });
}

/** Applies `fn` to the parts of a line outside inline `code spans`. */
function outsideCode(line: string, fn: (s: string) => string): string {
  let out = '', i = 0, last = 0;
  while (i < line.length) {
    if (line[i] !== '`') { i++; continue; }
    let n = 0; while (line[i + n] === '`') n++;
    const close = new RegExp(`(?<!\`)\`{${n}}(?!\`)`, 'g');
    close.lastIndex = i + n;
    const m = close.exec(line);
    if (!m) { i += n; continue; }
    out += fn(line.slice(last, i)) + line.slice(i, m.index + n);
    i = last = m.index + n;
  }
  return out + fn(line.slice(last));
}

/** Removes footnote refs from HTML (so unsupportedIn doesn't count them as super/subscript). */
export const stripFootnoteRefs = (html: string) =>
  html.replace(/<sup\s(?:[^>"']|"[^"]*"|'[^']*')*?data-footnote(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?<\/sup>/gi, '');

