// Images in site text: upload (shown at once from the picked file, then stored as the
// uploaded /site/… path), replace, crop (the posts editor's crop dialog) and remove.
// A path uploaded here isn't on the deployed site until it redeploys, so the editor shows
// it from the browser's copy, or (after a reload) fetched from GitHub.
import { uploadImage, getFile } from '../github';
import { pickFile } from '../ui/dom';
import { toast } from '../ui/toast';
import { openCrop } from '../editor/crop';
import type { Key } from './pointer';

export function createImages(o: { repaint(): void; origin: () => string }) {
  const previews = new Map<string, string>(); // site path → blob: URL
  const pending = new Map<Key, string>(); // field → blob: URL while its upload runs
  const probing = new Set<string>();
  const missing = new Set<string>();

  /** Fetch a path the deployed site doesn't have yet from the repo (public/<path>). */
  async function probe(path: string) {
    if (probing.has(path) || previews.has(path) || missing.has(path)) return;
    probing.add(path);
    try {
      const head = await fetch(new URL(path, o.origin()).href, { method: 'HEAD', cache: 'no-store' }).catch(() => null);
      if (head?.ok && (head.headers.get('content-type') || '').startsWith('image/')) { missing.add(path); return; } // it's live: use it as is
      const f = await getFile(`public${path}`);
      if (f?.content) {
        const bytes = Uint8Array.from(atob(String(f.content).replace(/\s/g, '')), (ch) => ch.charCodeAt(0));
        const type = /\.svg$/i.test(path) ? 'image/svg+xml' : /\.png$/i.test(path) ? 'image/png' : /\.jpe?g$/i.test(path) ? 'image/jpeg' : 'image/webp';
        previews.set(path, URL.createObjectURL(new Blob([bytes], { type })));
        o.repaint();
      } else missing.add(path);
    } catch { missing.add(path); }
    finally { probing.delete(path); }
  }
  function src(path: string, key?: Key): string {
    if (key && pending.has(key)) return pending.get(key)!;
    const p = previews.get(path);
    if (p) return p;
    if (/^\/site\//.test(path)) probe(path);
    return path;
  }

  /** Upload a file for the image field at key; resolves with the stored path (null if it failed). */
  async function upload(key: Key, file: File, dir: string, name: string, keepAlpha = true): Promise<string | null> {
    const blob = URL.createObjectURL(file);
    pending.set(key, blob);
    o.repaint();
    try {
      const r = await uploadImage(file, name, { dir, keepAlpha });
      previews.set(r.src, r.preview || blob);
      return r.src;
    } catch (e) {
      toast(`Couldn’t upload the image: ${(e as Error).message || 'something went wrong'}`, { kind: 'error', ms: 6000 });
      return null;
    } finally {
      pending.delete(key);
      o.repaint();
    }
  }
  const pick = () => pickFile('image/png,image/jpeg,image/webp,image/gif,image/avif');
  /** The current image as a blob (for cropping). */
  async function blobOf(path: string): Promise<Blob | null> {
    try {
      const r = await fetch(previews.get(path) || new URL(path, o.origin()).href);
      return r.ok ? await r.blob() : null;
    } catch { return null; }
  }
  async function crop(path: string, name: string): Promise<File | null> {
    const b = await blobOf(path);
    if (!b) { toast('Couldn’t open this image for cropping.'); return null; }
    return openCrop(b, { name });
  }
  return { src, upload, pick, crop, uploading: (k: Key) => pending.has(k), previews };
}
export type Images = ReturnType<typeof createImages>;
