// Image layout in markdown, without leaving the plain `![alt](src "caption")` form.
// The layout rides on a URL fragment of the image src (the site strips it, see src/plugins/figure.mjs):
//   ![a](/blog/x.webp "cap")          normal (text width)
//   ![a](/blog/x.webp#small "cap")    small, centered      → <figure class="size-small">
//   ![a](/blog/x.webp#wide "cap")     wider than the text  → <figure class="size-wide">
//   ![a](/blog/x.webp#full "cap")     edge to edge         → <figure class="size-full">
// Side-by-side images: consecutive image lines in ONE paragraph, each marked #row (or #row-wide /
// #row-full for a wider row), optionally followed by an *italic line* that captions the whole row:
//   ![a](/blog/a.webp#row "left caption")
//   ![b](/blog/b.webp#row "right caption")
//   *One caption for both*
// → <div class="gallery"><figure>…</figure><figure>…</figure><p class="gallery-caption">…</p></div>
// Anything without these exact fragments renders exactly as before.
import type TurndownService from 'turndown';
import type { Tokens } from 'marked';
import { toSite } from './lib';

export type ImgSize = 'normal' | 'small' | 'wide' | 'full';
export type RowSize = 'normal' | 'wide' | 'full';
export const IMG_SIZES: ImgSize[] = ['small', 'normal', 'wide', 'full'];
const FRAG = /#(small|wide|full|row(?:-(wide|full))?)$/;

/** Split a known layout fragment off an image src. */
export function splitFragment(href: string): { src: string; size: ImgSize; row: RowSize | null } {
  const s = href || '';
  const m = s.match(FRAG);
  if (!m) return { src: s, size: 'normal', row: null };
  const src = s.slice(0, m.index);
  if (m[1].startsWith('row')) return { src, size: 'normal', row: (m[2] as RowSize) || 'normal' };
  return { src, size: m[1] as ImgSize, row: null };
}
export const sizeFragment = (size: string | null | undefined) => (size === 'small' || size === 'wide' || size === 'full' ? '#' + size : '');
export const rowFragment = (size: string | null | undefined) => (size === 'wide' || size === 'full' ? '#row-' + size : '#row');
/** The size named by a `size-x` class on an element ('normal' if none). */
export function sizeOfClass(el: Element | null | undefined, allowed: readonly string[] = IMG_SIZES): ImgSize {
  const m = (el?.getAttribute('class') || '').match(/(?:^|\s)size-(small|wide|full)(?:\s|$)/);
  return m && allowed.includes(m[1]) ? (m[1] as ImgSize) : 'normal';
}

// ---------- markdown → editor HTML ----------
const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const text = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const sizeClass = (size: string) => (size && size !== 'normal' ? ` class="size-${size}"` : '');

/** <figure> for one image; a layout fragment on the href becomes the figure's size class. */
export function figureHtml(href: string, alt: string, title: string | null | undefined, inRow = false) {
  const { src, size } = splitFragment(href);
  return `<figure${inRow ? '' : sizeClass(size)}><img src="${attr(toSite(src))}" alt="${attr(alt)}">${title ? `<figcaption>${text(title)}</figcaption>` : ''}</figure>`;
}

const isBlankTok = (t: Tokens.Generic) => (t.type === 'text' && !String(t.raw).trim()) || t.type === 'br';
const stripTags = (s: string) => s.replace(/<[^>]*>/g, '');
/**
 * A paragraph that is a row of images (2+ images, all marked #row…, optionally a trailing *caption*),
 * as gallery HTML, or null. `inline` renders inline tokens (marked's parser.parseInline).
 */
export function galleryHtml(toks: Tokens.Generic[], inline: (t: Tokens.Generic[]) => string): string | null {
  const kids = toks.filter((t) => !isBlankTok(t));
  let cap: Tokens.Generic | null = null;
  if (kids.length && kids[kids.length - 1].type === 'em') cap = kids.pop()!;
  if (kids.length < 2 || !kids.every((t) => t.type === 'image' && splitFragment(t.href).row)) return null;
  const row = splitFragment(kids[0].href).row!;
  const figs = kids.map((t) => figureHtml(t.href, t.text, t.title, true)).join('');
  const capHtml = cap ? stripTags(inline(cap.tokens || [])).trim() : '';
  return `<div class="gallery${row !== 'normal' ? ` size-${row}` : ''}">${figs}${capHtml ? `<p class="gallery-caption">${capHtml}</p>` : ''}</div>\n`;
}

/** Gallery wrappers removed, so unsupportedIn() doesn't call them raw HTML. */
export const withoutGalleries = (html: string) => html.replace(/<div class="gallery(?: size-(?:wide|full))?">/g, '').replace(/<p class="gallery-caption">/g, '<p>');

// ---------- editor HTML → markdown ----------
type ImageMd = (img: Element, caption: string, frag: string) => string;
export function addImageRules(td: TurndownService, imageMd: ImageMd) {
  td.addRule('gallery', {
    filter: (node) => node.nodeName === 'DIV' && (node as HTMLElement).classList.contains('gallery'),
    replacement: (_c, node) => {
      const el = node as HTMLElement;
      const figs = Array.from(el.children).filter((c) => c.nodeName === 'FIGURE' && c.querySelector('img'));
      const capEl = Array.from(el.children).find((c) => c.nodeName === 'P' && c.classList.contains('gallery-caption'));
      const cap = (capEl?.textContent || '').replace(/\s+/g, ' ').trim();
      const capOf = (f: Element) => f.querySelector('figcaption')?.textContent || '';
      if (figs.length === 1) {
        const c = capOf(figs[0]) || cap; // a "row" of one is just an image
        return '\n\n' + imageMd(figs[0].querySelector('img')!, c, '') + '\n\n';
      }
      if (!figs.length) return cap ? '\n\n' + td.escape(cap) + '\n\n' : '';
      const frag = rowFragment(sizeOfClass(el, ['wide', 'full']));
      const lines = figs.map((f) => imageMd(f.querySelector('img')!, capOf(f), frag));
      if (cap) lines.push(`*${td.escape(cap)}*`); // td.escape covers * and _
      return '\n\n' + lines.join('\n') + '\n\n';
    },
  });
}
