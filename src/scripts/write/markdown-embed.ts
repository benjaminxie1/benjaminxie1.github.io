// Video embeds (YouTube, Vimeo, Loom): URL parsing, the markdown/HTML form, and parsing it back.
//
// SECURITY: /write shares an origin with a GitHub token, so an embed is never "whatever iframe was
// pasted". Everything goes through a strict (provider, id, start) triple parsed with allowlist
// regexes, and the iframe HTML is always rebuilt from that triple. Anything else is not an embed.
//
// Markdown form (raw HTML, one line, one block):
//   <div class="embed embed-youtube"><iframe src="https://www.youtube-nocookie.com/embed/ID" title="YouTube video" loading="lazy" allow="…" allowfullscreen></iframe></div>
// With a caption (plain text), like image figures:
//   <figure class="embed embed-youtube"><iframe …></iframe><figcaption>Caption</figcaption></figure>

export type Provider = 'youtube' | 'vimeo' | 'loom';
export type EmbedAttrs = { provider: Provider; id: string; start: number | null; caption: string };

export const PROVIDERS: Record<Provider, { name: string; id: RegExp }> = {
  youtube: { name: 'YouTube', id: /^[A-Za-z0-9_-]{11}$/ },
  vimeo: { name: 'Vimeo', id: /^\d{1,12}$/ },
  loom: { name: 'Loom', id: /^[0-9a-f]{32}$/ },
};
export const isProvider = (p: unknown): p is Provider => p === 'youtube' || p === 'vimeo' || p === 'loom';
export const providerName = (p: Provider) => PROVIDERS[p].name;

/** Validate/normalise attrs (used by the editor node too). Returns null if anything is off. */
export function cleanAttrs(a: { provider?: unknown; id?: unknown; start?: unknown; caption?: unknown }): EmbedAttrs | null {
  if (!isProvider(a.provider) || typeof a.id !== 'string' || !PROVIDERS[a.provider].id.test(a.id)) return null;
  const s = Number(a.start);
  const start = Number.isInteger(s) && s > 0 && s < 1e6 ? s : null;
  const caption = typeof a.caption === 'string' ? a.caption.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
  return { provider: a.provider, id: a.id, start, caption };
}

// ---------- time ----------
/** "90", "90s", "1m30s", "1h2m3s" → seconds (or null). */
export function parseTime(raw: string | null | undefined): number | null {
  const s = (raw || '').trim().toLowerCase();
  if (!s) return null;
  let n: number;
  if (/^\d{1,6}s?$/.test(s)) n = parseInt(s, 10);
  else {
    const m = s.match(/^(?:(\d{1,3})h)?(?:(\d{1,4})m)?(?:(\d{1,6})s)?$/);
    if (!m || !(m[1] || m[2] || m[3])) return null;
    n = (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0));
  }
  return n > 0 && n < 1e6 ? n : null;
}

// ---------- page URLs (what Ben pastes) ----------
/** A YouTube / Vimeo / Loom page or embed URL → attrs, or null. Strict: host allowlist + id regex. */
export function parseVideoUrl(input: string): EmbedAttrs | null {
  let s = (input || '').trim();
  if (!s || s.length > 500 || /\s/.test(s)) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) {
    if (!/^(?:[\w-]+\.)*(?:youtube\.com|youtube-nocookie\.com|youtu\.be|vimeo\.com|loom\.com)\//i.test(s)) return null;
    s = 'https://' + s;
  }
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password || (u.port && u.port !== '443' && u.port !== '80')) return null;
  const host = u.hostname.toLowerCase();
  const path = u.pathname.replace(/\/+$/, '');
  const q = u.searchParams;
  const hashT = (u.hash.match(/^#t=([\dhms]+)$/i) || [])[1];
  const mk = (provider: Provider, id: string | undefined, start: number | null) => cleanAttrs({ provider, id, start, caption: '' });

  if (host === 'youtu.be') {
    const id = (path.match(/^\/([A-Za-z0-9_-]{11})$/) || [])[1];
    return mk('youtube', id, parseTime(q.get('t') || q.get('start')));
  }
  if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(host)) {
    let id: string | undefined;
    if (path === '/watch') id = q.get('v') || undefined;
    else id = (path.match(/^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})$/) || [])[1];
    return mk('youtube', id, parseTime(q.get('t') || q.get('start') || hashT));
  }
  if (host === 'vimeo.com' || host === 'www.vimeo.com' || host === 'player.vimeo.com') {
    const id = (path.match(/^(?:\/video)?\/(\d{1,12})$/) || path.match(/^\/channels\/[\w-]+\/(\d{1,12})$/) || [])[1];
    return mk('vimeo', id, parseTime(hashT || q.get('t')));
  }
  if (host === 'loom.com' || host === 'www.loom.com') {
    const id = (path.match(/^\/(?:share|embed)\/(?:[\w-]*-)?([0-9a-f]{32})$/) || [])[1];
    return mk('loom', id, parseTime(q.get('t')));
  }
  return null;
}

// ---------- the embed iframe ----------
export function embedSrc(a: EmbedAttrs): string {
  const t = a.start ? a.start : 0;
  if (a.provider === 'youtube') return `https://www.youtube-nocookie.com/embed/${a.id}${t ? `?start=${t}` : ''}`;
  if (a.provider === 'vimeo') return `https://player.vimeo.com/video/${a.id}${t ? `#t=${t}s` : ''}`;
  return `https://www.loom.com/embed/${a.id}${t ? `?t=${t}` : ''}`;
}
export const EMBED_ALLOW = 'accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen';
export const posterUrl = (a: EmbedAttrs) => (a.provider === 'youtube' ? `https://i.ytimg.com/vi/${a.id}/hqdefault.jpg` : '');
export const pageUrl = (a: EmbedAttrs) =>
  a.provider === 'youtube' ? `https://www.youtube.com/watch?v=${a.id}${a.start ? `&t=${a.start}s` : ''}`
    : a.provider === 'vimeo' ? `https://vimeo.com/${a.id}${a.start ? `#t=${a.start}s` : ''}`
      : `https://www.loom.com/share/${a.id}${a.start ? `?t=${a.start}` : ''}`;

/** An iframe src from one of the allowlisted embed hosts → attrs (caption empty), or null. */
export function parseEmbedSrc(src: string): EmbedAttrs | null {
  const s = (src || '').trim().replace(/&amp;/g, '&');
  let m = s.match(/^(?:https:)?\/\/www\.youtube(?:-nocookie)?\.com\/embed\/([A-Za-z0-9_-]{11})(\?[\w=&%.-]*)?$/);
  if (m) return cleanAttrs({ provider: 'youtube', id: m[1], start: parseTime(((m[2] || '').match(/[?&]start=(\d+)/) || [])[1]) });
  m = s.match(/^(?:https:)?\/\/player\.vimeo\.com\/video\/(\d{1,12})(\?[\w=&%.-]*)?(#t=[\dhms]+)?$/);
  if (m) return cleanAttrs({ provider: 'vimeo', id: m[1], start: parseTime((m[3] || '').slice(3)) });
  m = s.match(/^(?:https:)?\/\/(?:www\.)?loom\.com\/embed\/([0-9a-f]{32})(\?[\w=&%.-]*)?$/);
  if (m) return cleanAttrs({ provider: 'loom', id: m[1], start: parseTime(((m[2] || '').match(/[?&]t=(\d+)/) || [])[1]) });
  return null;
}

const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const decode = (s: string) => s
  .replace(/&#(\d{1,7});/g, (_, n) => { const c = +n; return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ''; })
  .replace(/&#x([0-9a-f]{1,6});/gi, (_, n) => { const c = parseInt(n, 16); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ''; })
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

/** The one canonical HTML form (markdown body and site). Always rebuilt from validated attrs. */
export function embedHtml(attrs: EmbedAttrs): string {
  const a = cleanAttrs(attrs);
  if (!a) return '';
  const title = a.caption || `${providerName(a.provider)} video`;
  const iframe = `<iframe src="${escAttr(embedSrc(a))}" title="${escAttr(title)}" loading="lazy" allow="${EMBED_ALLOW}" allowfullscreen></iframe>`;
  const cls = `embed embed-${a.provider}`;
  return a.caption
    ? `<figure class="${cls}">${iframe}<figcaption>${escText(a.caption)}</figcaption></figure>`
    : `<div class="${cls}">${iframe}</div>`;
}

// ---------- HTML -> attrs ----------
const IFRAME = String.raw`<iframe\b[^<>]*>\s*<\/iframe>`;
const BLOCK_RE = new RegExp(
  String.raw`<(div|figure)\s+class="embed(?:\s+embed-[a-z]+)?"\s*>\s*${IFRAME}\s*(?:<figcaption>[^<]*<\/figcaption>\s*)?<\/\1>` +
  String.raw`|<p>\s*${IFRAME}\s*<\/p>|${IFRAME}`, 'gi');
const SRC_RE = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

/** One embed HTML block (canonical form, or a bare allowlisted iframe) → attrs, or null. */
export function parseEmbedHtml(block: string): EmbedAttrs | null {
  const b = (block || '').trim();
  if (!new RegExp(`^(?:${BLOCK_RE.source})$`, 'i').test(b)) return null;
  const tag = (b.match(new RegExp(IFRAME, 'i')) || [])[0] || '';
  const src = tag.match(SRC_RE);
  const a = src ? parseEmbedSrc(src[1] ?? src[2] ?? '') : null;
  if (!a) return null;
  const cap = b.match(/<figcaption>([^<]*)<\/figcaption>/i);
  return cleanAttrs({ ...a, caption: cap ? decode(cap[1]) : '' });
}

/** Replace every allowlisted embed in an HTML string with fn(attrs); others are left as they are. */
export function replaceEmbeds(html: string, fn: (a: EmbedAttrs) => string): string {
  return (html || '').replace(BLOCK_RE, (m) => { const a = parseEmbedHtml(m); return a ? fn(a) : m; });
}
/** markdown → editor HTML: rebuild allowlisted embeds into their canonical form. */
export const canonicalizeEmbeds = (html: string) => replaceEmbeds(html, embedHtml);
/** For unsupportedIn(): drop allowlisted embeds so they aren't flagged. */
export const stripEmbeds = (html: string) => replaceEmbeds(html, () => '');

/** DOM element (div.embed / figure.embed / iframe) → attrs, or null. Used by the editor and turndown. */
export function parseEmbedElement(el: Element): EmbedAttrs | null {
  let iframe: Element | null;
  let caption = '';
  if (el.nodeName === 'IFRAME') iframe = el;
  else {
    if (!/^(DIV|FIGURE)$/.test(el.nodeName) || !el.classList.contains('embed')) return null;
    const kids = Array.from(el.children);
    iframe = kids[0]?.nodeName === 'IFRAME' ? kids[0] : null;
    const rest = kids.slice(1);
    if (rest.length > 1 || (rest[0] && rest[0].nodeName !== 'FIGCAPTION')) return null;
    caption = rest[0]?.textContent || '';
  }
  if (!iframe) return null;
  const a = parseEmbedSrc(iframe.getAttribute('src') || '');
  return a ? cleanAttrs({ ...a, caption }) : null;
}

/** Turndown rule: embeds become their canonical HTML block; any other iframe is dropped. */
export const embedTurndownRule = {
  filter: (node: HTMLElement) => node.nodeName === 'IFRAME' || (/^(DIV|FIGURE)$/.test(node.nodeName) && node.classList.contains('embed')),
  replacement: (_content: string, node: unknown) => {
    const a = parseEmbedElement(node as Element);
    return a ? '\n\n' + embedHtml(a) + '\n\n' : '';
  },
};
