// GitHub REST helpers (contents API) for the /write editor.
import { OWNER, REPO, BRANCH, TOKEN_KEY, store } from './lib';

// ---------- GitHub ----------
export const token = () => store.get(TOKEN_KEY) || '';
export async function gh(path: string, init: RequestInit = {}) {
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}${path}`, {
    ...init,
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token()}`, 'X-GitHub-Api-Version': '2022-11-28', ...(init.headers || {}) },
    cache: 'no-store',
  });
  if (!res.ok && res.status !== 404) {
    const body = await res.json().catch(() => ({}));
    throw new Error(res.status === 401 ? 'GitHub key is invalid or expired' : res.status === 403 ? 'GitHub key doesn’t have write access' : body.message || `GitHub error ${res.status}`);
  }
  return res;
}
export const b64 = (s: string) => { const bytes = new TextEncoder().encode(s); let bin = ''; bytes.forEach((b) => (bin += String.fromCharCode(b))); return btoa(bin); };
export const unb64 = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, '')), (c) => c.charCodeAt(0)));
export async function getFile(path: string) {
  const r = await gh(`/contents/${path}?ref=${BRANCH}`);
  if (r.status === 404) return null;
  return r.json();
}
export async function putFile(path: string, base64: string, message: string, sha?: string | null) {
  const body = JSON.stringify({ message, content: base64, branch: BRANCH, ...(sha ? { sha } : {}) });
  let r = await gh(`/contents/${path}`, { method: 'PUT', body });
  if (r.status === 404) throw new Error('Repo not found: check the key’s repository access');
  return r.json();
}


// ---------- contract API (STUB: DATA workstream replaces these with robust versions) ----------
import { POSTS_DIR, MEDIA_DIR, type Doc, slugify, slugOf } from './lib';
import { toMarkdown, parseMarkdown } from './markdown';

export class ConflictError extends Error {
  remote: Doc | null;
  constructor(remote: Doc | null) { super('This post was changed somewhere else since you opened it.'); this.remote = remote; }
}
export function setToken(t: string) { store.set(TOKEN_KEY, t.trim()); }
export function clearToken() { store.del(TOKEN_KEY); }
export async function testToken(): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const r = await gh('');
    if (r.status === 404) return { ok: false, message: 'Can’t see the repo: check repository access' };
    const repo = await r.json();
    return repo.permissions?.push ? { ok: true } : { ok: false, message: 'Key can read but not write' };
  } catch (e) { return { ok: false, message: (e as Error).message }; }
}
export async function listPosts() {
  const r = await gh(`/contents/${POSTS_DIR}?ref=${BRANCH}`);
  if (r.status === 404) return [];
  const items = ((await r.json()) as { name: string; path: string }[]).filter((f) => /\.mdx?$/.test(f.name));
  return Promise.all(items.map(async (f) => {
    const d = await loadPost(f.path);
    return { path: f.path, sha: d.sha!, title: d.title, date: d.date, draft: d.draft, description: d.description };
  }));
}
export async function loadPost(path: string): Promise<Doc> {
  const f = await getFile(path);
  if (!f) throw new Error('Post not found');
  return parseMarkdown(unb64(f.content), path, f.sha);
}
export async function isSlugTaken(slug: string) { return !!(await getFile(`${POSTS_DIR}/${slug}.md`)); }
export async function savePost(doc: Doc, opts: { draft: boolean; force?: boolean }): Promise<Doc> {
  const next: Doc = { ...doc, draft: opts.draft };
  if (!next.path) {
    const base = next.slug || slugify(next.title) || 'post';
    let slug = base, n = 2;
    while (await isSlugTaken(slug)) slug = `${base}-${n++}`;
    next.path = `${POSTS_DIR}/${slug}.md`;
  }
  const msg = `${opts.draft ? 'Draft' : doc.published ? 'Update' : 'Publish'}: ${next.title.trim()}`;
  try {
    const out = await putFile(next.path, b64(toMarkdown(next)), msg, next.sha);
    return { ...next, sha: out.content.sha, published: !opts.draft };
  } catch (e) {
    if (/does not match|sha/i.test((e as Error).message)) {
      if (!opts.force) throw new ConflictError(await loadPost(next.path).catch(() => null));
      const cur = await getFile(next.path);
      const out = await putFile(next.path, b64(toMarkdown(next)), msg, cur?.sha);
      return { ...next, sha: out.content.sha, published: !opts.draft };
    }
    throw e;
  }
}
export async function deletePost(doc: Doc) {
  if (!doc.path) return;
  const cur = await getFile(doc.path);
  if (!cur) return;
  await gh(`/contents/${doc.path}`, { method: 'DELETE', body: JSON.stringify({ message: `Delete: ${doc.title}`, sha: cur.sha, branch: BRANCH }) });
}
async function shrink(file: File, max = 1800): Promise<{ blob: Blob; ext: string }> {
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') return { blob: file, ext: file.type === 'image/gif' ? 'gif' : 'svg' };
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / bmp.width);
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/webp', 0.86));
  return { blob, ext: 'webp' };
}
const blobB64 = (b: Blob) => new Promise<string>((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(b); });
export async function uploadImage(file: File, baseName: string) {
  const { blob, ext } = await shrink(file);
  const name = `${slugify(baseName) || 'post'}-${Date.now().toString(36)}.${ext}`;
  await putFile(`${MEDIA_DIR}/${name}`, await blobB64(blob), `Image: ${name}`);
  return { src: `/blog/${name}`, preview: URL.createObjectURL(blob) };
}
export async function postHistory(path: string) {
  const r = await gh(`/commits?path=${encodeURIComponent(path)}&sha=${BRANCH}&per_page=30`);
  if (r.status === 404) return [];
  return ((await r.json()) as any[]).map((c) => ({ commit: c.sha as string, date: c.commit.author.date as string, message: c.commit.message as string }));
}
export async function loadPostAt(path: string, commit: string): Promise<Doc> {
  const r = await gh(`/contents/${path}?ref=${commit}`);
  const f = await r.json();
  return parseMarkdown(unb64(f.content), path, null as unknown as string);
}
export async function deployStatus(_afterIso: string): Promise<'pending' | 'running' | 'live' | 'failed' | 'unknown'> { return 'unknown'; }
export { slugOf };
