// Small shared pieces for images in the editor: icons, remote-image fetching, src policy.
import { toSite } from '../lib';

export const GALLERY_MAX = 3;

const svg = (d: string) => `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
// Width icons: the text column is the two thin lines; the block is the image.
export const imgIcons = {
  small: svg('<path d="M3 2.5h10M3 13.5h10" stroke-width="1.2" opacity=".55"/><rect x="5.5" y="5" width="5" height="6" rx="1"/>'),
  normal: svg('<path d="M3 2.5h10M3 13.5h10" stroke-width="1.2" opacity=".55"/><rect x="3" y="5" width="10" height="6" rx="1"/>'),
  wide: svg('<path d="M4 2.5h8M4 13.5h8" stroke-width="1.2" opacity=".55"/><rect x="1.5" y="5" width="13" height="6" rx="1"/>'),
  full: svg('<path d="M4 2.5h8M4 13.5h8" stroke-width="1.2" opacity=".55"/><path d="M0.5 5h15v6H0.5z"/>'),
  crop: svg('<path d="M4.5 1.5v10h10"/><path d="M1.5 4.5h10v10"/>'),
  replace: svg('<path d="M2.5 6.5a5.5 5.5 0 0 1 10-2.2M13.5 9.5a5.5 5.5 0 0 1-10 2.2"/><path d="M12.8 1.6v2.9H9.9M3.2 14.4v-2.9h2.9"/>'),
  rotate: svg('<path d="M13 8a5 5 0 1 1-1.6-3.7"/><path d="M13.4 1.8v3h-3"/>'),
  row: svg('<rect x="1.5" y="4" width="6" height="8" rx="1"/><rect x="8.5" y="4" width="6" height="8" rx="1"/>'),
  stack: svg('<rect x="3" y="1.5" width="10" height="5.5" rx="1"/><rect x="3" y="9" width="10" height="5.5" rx="1"/>'),
  plus: svg('<path d="M8 3v10M3 8h10"/>'),
};

/** True for a src that isn't one of the site's own files: it must be copied into the repo before saving. */
export function isForeignSrc(src: string): boolean {
  const s = toSite((src || '').trim());
  if (/^(blob|data|filesystem):/i.test(s)) return true;
  return !(s.startsWith('/') && !s.startsWith('//'));
}

const EXT: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif' };
/** Fetch an image URL into a File (needs CORS for http(s) URLs). Throws if it can't, or it isn't an image. */
export async function fetchImageFile(url: string): Promise<File> {
  const signal = typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(20000) : undefined;
  const r = await fetch(url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', signal });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const blob = await r.blob();
  if (!blob.size) throw new Error('empty');
  const path = /^data:/i.test(url) ? '' : new URL(url, location.href).pathname;
  const ext = (path.match(/\.(\w{2,5})$/) || [])[1]?.toLowerCase() || '';
  let type = blob.type && blob.type.startsWith('image/') ? blob.type : EXT[ext] || '';
  if (!type) {
    if (blob.type && !/octet-stream|binary/.test(blob.type)) throw new Error('not an image');
    type = 'image/png'; // unknown: let the decoder decide (prepareImage re-encodes anyway)
  }
  const name = (path.split('/').pop() || 'pasted-image').replace(/\.\w+$/, '') || 'pasted-image';
  return new File([blob], `${name}.${type.split('/')[1].replace('jpeg', 'jpg')}`, { type });
}
