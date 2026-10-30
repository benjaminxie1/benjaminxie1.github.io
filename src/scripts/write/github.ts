// GitHub REST access for the /write editor: posts, images, history, deploy status.
// All repo writes go through one serialized queue (the contents API must not be
// written concurrently on one branch) with retry/backoff for branch races and 5xx.
import { OWNER, REPO, BRANCH, POSTS_DIR, MEDIA_DIR, TOKEN_KEY, store, type Doc, slugify, slugOf } from './lib';
import { toMarkdown, parseMarkdown } from './markdown';

// ---------- errors ----------
export type GitHubErrorKind = 'offline' | 'rate' | 'auth' | 'access' | 'notfound' | 'toolarge' | 'conflict' | 'server' | 'other';
export class GitHubError extends Error {
  status: number; kind: GitHubErrorKind;
  constructor(message: string, kind: GitHubErrorKind, status = 0) { super(message); this.name = 'GitHubError'; this.kind = kind; this.status = status; }
}
export class ConflictError extends Error {
  remote: Doc | null;
  constructor(remote: Doc | null) {
    super(remote ? 'This post was changed somewhere else since you opened it.' : 'This post was deleted or moved on GitHub since you opened it.');
    this.name = 'ConflictError'; this.remote = remote;
  }
}

// ---------- token ----------
export const token = () => store.get(TOKEN_KEY) || '';
export function setToken(t: string) { store.set(TOKEN_KEY, t.trim()); }
export function clearToken() { store.del(TOKEN_KEY); }

// ---------- low-level request ----------
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const backoff = (n: number) => Math.min(8000, 400 * 2 ** n) * (0.75 + Math.random() * 0.5);
const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

async function humanError(res: Response): Promise<GitHubError> {
  const body: any = await res.clone().json().catch(() => ({}));
  const msg = String(body?.message || '');
  const s = res.status;
  const remaining = res.headers.get('x-ratelimit-remaining');
  if ((s === 403 || s === 429) && (remaining === '0' || /rate limit/i.test(msg) || res.headers.get('retry-after'))) {
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    const retry = Number(res.headers.get('retry-after'));
    const when = retry ? `in about ${Math.max(1, Math.ceil(retry / 60))} min` : reset ? `after ${new Date(reset * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'in a few minutes';
    return new GitHubError(remaining === '0' ? `GitHub’s hourly limit is used up. Try again ${when}. Your writing is safe on this device.` : `GitHub asked us to slow down. Try again ${when}. Your writing is safe on this device.`, 'rate', s);
  }
  if (s === 401) return new GitHubError('Your GitHub key is invalid or has expired. Add a new one in Settings.', 'auth', s);
  if (s === 403) return new GitHubError('Your GitHub key doesn’t have permission for this. It needs Contents: Read and write on ' + REPO + '.', 'access', s);
  if (s === 404) return new GitHubError('Not found on GitHub (or your key can’t see ' + REPO + ').', 'notfound', s);
  if (s === 413 || (s === 422 && /too large|too big|size/i.test(msg))) return new GitHubError('That file is too large for GitHub.', 'toolarge', s);
  if (s === 409) return new GitHubError(msg || 'GitHub reported a conflict.', 'conflict', s);
  if (s >= 500) return new GitHubError('GitHub is having trouble right now. Try again in a minute.', 'server', s);
  return new GitHubError(msg ? `GitHub said: ${msg}` : `GitHub error ${s}`, 'other', s);
}

type ReqOpts = RequestInit & { allow404?: boolean; tok?: string; retries?: number };
/** Fetch the repo API. Retries network errors and 5xx (and 409 on reads). 404 → null if allow404. Throws GitHubError. */
async function request(path: string, opts: ReqOpts = {}): Promise<Response | null> {
  const { allow404, tok, retries = 3, ...init } = opts;
  const url = path.startsWith('https://') ? path : API + path;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${tok ?? token()}`, 'X-GitHub-Api-Version': '2022-11-28', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) },
        cache: 'no-store',
      });
    } catch {
      if (isOffline()) throw new GitHubError('You’re offline. Your writing is saved on this device; try again when you’re connected.', 'offline');
      if (attempt < retries) { await sleep(backoff(attempt)); continue; }
      throw new GitHubError('Couldn’t reach GitHub. Check your connection and try again.', 'offline');
    }
    if (res.ok) return res;
    if (res.status === 404 && allow404) return null;
    if (res.status >= 500 && attempt < retries) { await sleep(backoff(attempt)); continue; }
    throw await humanError(res);
  }
}
async function json<T = any>(path: string, opts: ReqOpts = {}): Promise<T | null> {
  const r = await request(path, opts);
  return r ? ((await r.json()) as T) : null;
}

// ---------- serialized write queue ----------
let chain: Promise<unknown> = Promise.resolve();
/** Run fn after every previously queued write has settled. */
export function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const p = chain.then(fn, fn);
  chain = p.catch(() => {});
  return p;
}

// ---------- encoding ----------
export const b64 = (s: string) => bytesB64(new TextEncoder().encode(s));
const bytesB64 = (bytes: Uint8Array) => { let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(bin); };
export const unb64 = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, '')), (c) => c.charCodeAt(0)));

// ---------- file primitives ----------
type FileInfo = { sha: string; text: string };
const blobCache = new Map<string, string>(); // blob sha → text (immutable, safe to cache)
async function blobText(sha: string): Promise<string> {
  const hit = blobCache.get(sha);
  if (hit != null) return hit;
  const b = await json<{ content: string; encoding: string }>(`/git/blobs/${sha}`);
  const text = b!.encoding === 'base64' ? unb64(b!.content) : b!.content;
  blobCache.set(sha, text);
  return text;
}
const enc = (p: string) => p.split('/').map(encodeURIComponent).join('/');
/** Current file (sha + text) at ref, or null. Files over 1MB come via the blobs API. */
async function readFile(path: string, ref = BRANCH): Promise<FileInfo | null> {
  const f = await json<any>(`/contents/${enc(path)}?ref=${encodeURIComponent(ref)}`, { allow404: true });
  if (!f) return null;
  if (Array.isArray(f) || f.type !== 'file') throw new GitHubError(`${path} isn’t a file.`, 'other');
  const text = f.encoding === 'base64' && f.content ? unb64(f.content) : await blobText(f.sha);
  blobCache.set(f.sha, text);
  return { sha: f.sha, text };
}
async function currentSha(path: string): Promise<string | null> {
  const f = await json<any>(`/contents/${enc(path)}?ref=${BRANCH}`, { allow404: true, headers: { Accept: 'application/vnd.github.object+json' } });
  return f && !Array.isArray(f) ? f.sha : null;
}

type PutResult = { content: { sha: string; path: string }; commit: { sha: string; committer?: { date: string }; author?: { date: string } } };
/**
 * Write a file (must be called inside the queue). `expectSha` is the sha we based our
 * change on (null = must not exist). On 409/422 we look at the real sha: if it differs,
 * it's a genuine conflict (resolved by onConflict); if it matches, the branch just
 * moved under us and we retry with backoff.
 */
async function putRaw(pathOf: string | (() => string), base64: string, message: string, expectSha: string | null, onConflict: (cur: string | null) => Promise<string | null | 'abort'>): Promise<PutResult> {
  let sha = expectSha;
  const at = () => (typeof pathOf === 'string' ? pathOf : pathOf());
  for (let attempt = 0; ; attempt++) {
    const path = at();
    try {
      const r = await request(`/contents/${enc(path)}`, { method: 'PUT', body: JSON.stringify({ message, content: base64, branch: BRANCH, ...(sha ? { sha } : {}) }) });
      return (await r!.json()) as PutResult;
    } catch (e) {
      const ge = e as GitHubError;
      if (!(ge instanceof GitHubError) || !(ge.status === 409 || (ge.status === 422 && !/too large/i.test(ge.message)))) throw e;
      const cur = await currentSha(path);
      if (cur !== sha) {
        const next = await onConflict(cur);
        if (next === 'abort') throw new ConflictError(null);
        sha = next;
        if (at() !== path) continue; // caller picked a new path: retry right away
      } else if (ge.status === 422) {
        throw e; // a real validation error, not a race
      }
      if (attempt >= 5) throw new GitHubError('GitHub is busy with other changes. Try saving again in a moment.', 'conflict', ge.status);
      await sleep(backoff(attempt));
    }
  }
}

// ---------- token test ----------
/** Proves the key can WRITE to the repo without changing it (creates an unreferenced, empty git blob). */
export async function testToken(candidate?: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const tok = (candidate ?? token()).trim();
  if (!tok) return { ok: false, message: 'Paste a GitHub key first.' };
  try {
    const repo = await json<any>('', { tok, allow404: true, retries: 1 });
    if (!repo) return { ok: false, message: `This key can’t see ${OWNER}/${REPO}. Give it access to that repository.` };
    if (repo.permissions && repo.permissions.push === false) return { ok: false, message: 'This key can read the repo but not write to it.' };
    try {
      await request('/git/blobs', { tok, method: 'POST', retries: 1, body: JSON.stringify({ content: '', encoding: 'utf-8' }) });
    } catch (e) {
      const ge = e as GitHubError;
      if (ge.kind === 'access' || ge.kind === 'notfound') return { ok: false, message: 'This key can read the repo but can’t write. Set “Contents” to “Read and write”.' };
      throw e;
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

// ---------- posts ----------
type TreeEntry = { path: string; sha: string; type: string; size?: number };
async function postFiles(): Promise<TreeEntry[]> {
  const t = await json<{ tree: TreeEntry[]; truncated: boolean }>(`/git/trees/${encodeURIComponent(`${BRANCH}:${POSTS_DIR}`)}?recursive=1`, { allow404: true });
  if (!t) return [];
  return t.tree.filter((e) => e.type === 'blob' && /\.mdx?$/i.test(e.path)).map((e) => ({ ...e, path: `${POSTS_DIR}/${e.path}` }));
}
async function pool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}
export type PostSummary = { path: string; sha: string; title: string; date: string; draft: boolean; description: string; error?: string };
export async function listPosts(): Promise<PostSummary[]> {
  const files = await postFiles();
  const list = await pool(files, 6, async (f): Promise<PostSummary> => {
    const name = f.path.split('/').pop()!.replace(/\.mdx?$/i, '');
    try {
      const d = parseMarkdown(await blobText(f.sha), f.path, f.sha);
      return { path: f.path, sha: f.sha, title: d.title, date: d.date, draft: d.draft, description: d.description };
    } catch (e) {
      if (e instanceof GitHubError && (e.kind === 'auth' || e.kind === 'rate' || e.kind === 'offline')) throw e;
      return { path: f.path, sha: f.sha, title: name, date: '', draft: true, description: '', error: (e as Error).message };
    }
  });
  return list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}
export async function loadPost(path: string): Promise<Doc> {
  const f = await readFile(path);
  if (!f) throw new GitHubError('This post no longer exists on GitHub.', 'notfound', 404);
  return parseMarkdown(f.text, path, f.sha);
}
/** The post as it was at `commit`. sha is that version's blob sha; to restore it, keep the CURRENT doc's sha and copy the content fields. */
export async function loadPostAt(path: string, commit: string): Promise<Doc> {
  const f = await readFile(path, commit);
  if (!f) throw new GitHubError('That version of the post couldn’t be found.', 'notfound', 404);
  return parseMarkdown(f.text, path, f.sha);
}
export async function postHistory(path: string): Promise<Array<{ commit: string; date: string; message: string }>> {
  const list = await json<any[]>(`/commits?path=${encodeURIComponent(path)}&sha=${BRANCH}&per_page=50`, { allow404: true });
  return (list || []).map((c) => ({ commit: c.sha as string, date: (c.commit?.committer?.date || c.commit?.author?.date) as string, message: String(c.commit?.message || '').split('\n')[0] }));
}
const slugKey = (s: string) => s.toLowerCase();
export async function isSlugTaken(slug: string): Promise<boolean> {
  const want = slugKey(slug);
  return (await postFiles()).some((f) => slugKey(f.path.split('/').pop()!.replace(/\.mdx?$/i, '')) === want);
}

export async function savePost(doc: Doc, opts: { draft: boolean; force?: boolean }): Promise<Doc> {
  const next: Doc = { ...doc, draft: opts.draft };
  const content = b64(toMarkdown(next)); // throws UnsavedImageError before touching the network
  return enqueue(async () => {
    const isNew = !next.path;
    if (isNew) {
      const taken = new Set((await postFiles()).map((f) => slugKey(f.path.split('/').pop()!.replace(/\.mdx?$/i, ''))));
      const base = slugify(next.slug || next.title || '');
      let slug = base, n = 2;
      while (taken.has(slugKey(slug))) slug = `${base}-${n++}`;
      next.path = `${POSTS_DIR}/${slug}.md`;
      next.sha = null;
    }
    const msg = `${opts.draft ? 'Draft' : doc.published ? 'Update' : 'Publish'}: ${next.title.trim() || slugOf(next)}`;
    let tries = 0;
    const out = await putRaw(() => next.path!, content, msg, next.sha, async (cur) => {
      if (isNew) {
        // someone took this filename between our check and our write: pick the next one
        if (++tries > 5) return 'abort';
        next.path = next.path!.replace(/(?:-(\d+))?\.md$/, (_m, k) => `-${(Number(k) || 1) + 1}.md`);
        return null;
      }
      if (opts.force) return cur;
      throw new ConflictError(cur ? await loadPost(next.path!).catch(() => null) : null);
    });
    blobCache.set(out.content.sha, toMarkdown(next));
    return {
      ...next, sha: out.content.sha, published: !opts.draft,
      lastCommit: { sha: out.commit.sha, date: out.commit.committer?.date || out.commit.author?.date || new Date().toISOString() },
    };
  });
}
/** Deletes only the post file (images stay). Throws ConflictError if it changed since doc.sha, unless force. */
export async function deletePost(doc: Doc, opts: { force?: boolean } = {}): Promise<void> {
  if (!doc.path) return;
  const path = doc.path;
  return enqueue(async () => {
    for (let attempt = 0; ; attempt++) {
      const cur = await currentSha(path);
      if (!cur) return;
      if (doc.sha && cur !== doc.sha && !opts.force) throw new ConflictError(await loadPost(path).catch(() => null));
      try {
        await request(`/contents/${enc(path)}`, { method: 'DELETE', body: JSON.stringify({ message: `Delete: ${doc.title.trim() || slugOf(doc)}`, sha: cur, branch: BRANCH }) });
        return;
      } catch (e) {
        if (!(e instanceof GitHubError) || e.status !== 409 || attempt >= 5) throw e;
        await sleep(backoff(attempt));
      }
    }
  });
}

// ---------- deploys ----------
export type DeployState = 'pending' | 'running' | 'live' | 'failed' | 'unknown';
/**
 * State of the newest deploy.yml run on main created at/after `afterIso` (pass
 * savePost's lastCommit.date; optional commitSha also matches its run exactly).
 * 'unknown' when the key can't read Actions (403/404). Other errors throw.
 */
export async function deployStatus(afterIso: string, commitSha?: string): Promise<DeployState> {
  const after = Date.parse(afterIso) - 5000; // tolerate small clock/rounding differences
  const since = new Date(isNaN(after) ? 0 : after).toISOString().replace(/\.\d+Z$/, 'Z');
  let r: { workflow_runs: any[] } | null;
  try {
    r = await json(`/actions/workflows/deploy.yml/runs?branch=${BRANCH}&per_page=20&created=${encodeURIComponent('>=' + since)}`, { allow404: true });
  } catch (e) {
    if (e instanceof GitHubError && (e.kind === 'access' || e.kind === 'auth' || e.kind === 'notfound')) return 'unknown';
    throw e;
  }
  if (!r) return 'unknown';
  const runs = (r.workflow_runs || [])
    .filter((x) => (commitSha && x.head_sha === commitSha) || Date.parse(x.created_at) >= after)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const run = runs[0];
  if (!run) return 'pending';
  if (run.status === 'completed') return run.conclusion === 'success' ? 'live' : run.conclusion === 'cancelled' && runs[1]?.conclusion === 'success' ? 'live' : 'failed';
  if (run.status === 'in_progress') return 'running';
  return 'pending'; // queued, waiting, requested, pending
}

// ---------- images ----------
const MAX_SIDE = 2000, MAX_BYTES = 1.5 * 1024 * 1024, MAX_GIF = 8 * 1024 * 1024;
const mb = (n: number) => (n / 1024 / 1024).toFixed(1) + ' MB';
async function decode(file: File): Promise<{ img: CanvasImageSource; w: number; h: number; close(): void }> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    return { img: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close() };
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const el = new Image();
      el.src = url;
      await el.decode();
      return { img: el, w: el.naturalWidth, h: el.naturalHeight, close: () => {} };
    } finally { URL.revokeObjectURL(url); }
  }
}
const toBlob = (c: HTMLCanvasElement, type: string, q: number) => new Promise<Blob | null>((r) => c.toBlob(r, type, q));
/**
 * Resize/re-encode a photo: longest side ≤ 2000px, ≤ ~1.5MB, webp if the browser can encode it, else jpeg. Strips EXIF.
 * `keepAlpha` (logos): transparency is kept — never flattened onto white — as webp with alpha, else PNG.
 */
export async function prepareImage(file: File, opts: { keepAlpha?: boolean } = {}): Promise<{ blob: Blob; ext: string }> {
  const keepAlpha = !!opts.keepAlpha;
  const type = (file.type || '').toLowerCase();
  const name = (file.name || '').toLowerCase();
  if (type === 'image/gif' || name.endsWith('.gif')) {
    if (file.size > MAX_GIF) throw new Error(`This GIF is ${mb(file.size)}; the limit is 8 MB. Try a shorter or smaller GIF.`);
    return { blob: file, ext: 'gif' };
  }
  // SVGs can carry scripts that would run on this site's origin (where the GitHub key lives), so they're not uploaded.
  if (type === 'image/svg+xml' || name.endsWith('.svg')) throw new Error('SVG files aren’t supported. Export it as PNG and try again.');
  const heic = /hei[cf]/.test(type) || /\.hei[cf]$/.test(name);
  if (type && !type.startsWith('image/')) throw new Error('That file isn’t an image.');
  let src;
  try { src = await decode(file); } catch {
    throw new Error(heic ? 'This browser can’t read HEIC photos. Export it as JPEG or PNG (on iPhone: Settings → Camera → Formats → Most Compatible) and try again.' : 'This image format isn’t supported. Try a JPEG, PNG, WebP or GIF.');
  }
  try {
    let scale = Math.min(1, MAX_SIDE / Math.max(src.w, src.h));
    const c = document.createElement('canvas');
    for (let round = 0; round < 6; round++) {
      c.width = Math.max(1, Math.round(src.w * scale)); c.height = Math.max(1, Math.round(src.h * scale));
      const ctx = c.getContext('2d')!;
      ctx.clearRect(0, 0, c.width, c.height);
      if (!keepAlpha) {
        ctx.fillStyle = '#ffffff'; // jpeg has no alpha
        ctx.fillRect(0, 0, c.width, c.height);
      }
      ctx.drawImage(src.img, 0, 0, c.width, c.height);
      for (const q of [0.86, 0.76, 0.66]) {
        let blob = await toBlob(c, 'image/webp', q);
        let ext = 'webp';
        if (!blob || blob.type !== 'image/webp') {
          // Safari < 17 can't encode webp: jpeg for photos, PNG (keeps alpha) for logos
          if (keepAlpha) { blob = await toBlob(c, 'image/png', 1); ext = 'png'; }
          else { blob = await toBlob(c, 'image/jpeg', q); ext = 'jpg'; }
        }
        if (!blob) throw new Error('Couldn’t process this image.');
        if (blob.size <= MAX_BYTES) return { blob, ext };
      }
      scale *= 0.75;
    }
    throw new Error('Couldn’t shrink this image enough. Try a smaller one.');
  } finally { src.close(); }
}
const blobB64 = async (b: Blob) => bytesB64(new Uint8Array(await b.arrayBuffer()));
const rand = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), (x) => x.toString(36).padStart(2, '0')).join('').slice(0, 7);
/** Repo folders uploads may go to: `public/<segment>[/<segment>…]` (e.g. public/blog, public/site). */
const UPLOAD_DIR_RE = /^public(?:\/[a-z0-9][a-z0-9_-]*)+$/i;
/**
 * Upload an image to the repo and return its site path. Default folder: public/blog (posts), so
 * existing callers are unchanged. `dir: 'public/site'` for site images (logos, project shots);
 * `keepAlpha` keeps transparency (logos). `keepPng` is accepted as an alias of `keepAlpha`.
 */
export async function uploadImage(
  file: File,
  baseName: string,
  opts: { dir?: string; keepAlpha?: boolean; keepPng?: boolean } = {},
): Promise<{ src: string; preview: string }> {
  const dir = (opts.dir ?? MEDIA_DIR).replace(/\/+$/, '');
  if (!UPLOAD_DIR_RE.test(dir)) throw new Error(`Can’t upload images to “${dir}”.`);
  const urlBase = dir.slice('public'.length); // "/blog", "/site"
  const { blob, ext } = await prepareImage(file, { keepAlpha: !!(opts.keepAlpha || opts.keepPng) });
  const data = await blobB64(blob);
  const stem = slugify(baseName || '', 'image').slice(0, 40).replace(/-+$/, '') || 'image';
  let name = `${stem}-${rand()}.${ext}`;
  let tries = 0;
  await enqueue(() => putRaw(() => `${dir}/${name}`, data, `Image: ${stem}`, null, async () => {
    if (++tries > 3) return 'abort';
    name = `${stem}-${rand()}.${ext}`; // name collision (astronomically unlikely): pick another
    return null;
  }));
  return { src: `${urlBase}/${name}`, preview: URL.createObjectURL(blob) };
}

// ---------- legacy helpers (used by the pre-contract main.ts; keep until APP drops them) ----------
export async function gh(path: string, init: RequestInit = {}) {
  return (await request(path, { ...init, allow404: true })) ?? new Response(null, { status: 404 });
}
export async function getFile(path: string) {
  return json<any>(`/contents/${enc(path)}?ref=${BRANCH}`, { allow404: true });
}
export async function putFile(path: string, base64: string, message: string, sha?: string | null) {
  return enqueue(() => putRaw(path, base64, message, sha ?? null, async () => { throw new ConflictError(null); }));
}
export { slugOf };

// ---------- generic JSON files (site text in src/content/site/*.json) ----------
/** A file changed on GitHub since `expectSha` (or appeared/disappeared). */
export class FileConflictError extends Error {
  path: string; current: string | null;
  constructor(path: string, current: string | null) {
    super(`${path.split('/').pop()} was changed on GitHub since you opened it.`);
    this.name = 'FileConflictError'; this.path = path; this.current = current;
  }
}
/** Current JSON file on the branch: its blob sha, raw text and parsed value. null if it doesn't exist. */
export async function loadJson<T = unknown>(path: string): Promise<{ sha: string; text: string; data: T } | null> {
  const f = await readFile(path);
  if (!f) return null;
  let data: T;
  try { data = JSON.parse(f.text) as T; }
  catch { throw new GitHubError(`${path.split('/').pop()} on GitHub isn’t valid JSON, so it can’t be edited here.`, 'other'); }
  return { sha: f.sha, text: f.text, data };
}
export type SavedFile = { path: string; sha: string; commit: { sha: string; date: string } };
/**
 * Commit text files one after another (serialized with every other repo write). Each
 * write must be based on `expectSha` (null = must not exist yet): if GitHub has a
 * different version, throws FileConflictError and stops; files written before it stay
 * written (onSaved reports each one as it lands).
 */
export async function saveFiles(files: { path: string; content: string; expectSha: string | null }[], message: string, o: { onSaved?: (r: SavedFile) => void } = {}): Promise<SavedFile[]> {
  return enqueue(async () => {
    const out: SavedFile[] = [];
    for (const f of files) {
      const res = await putRaw(f.path, b64(f.content), message, f.expectSha, async (cur) => { throw new FileConflictError(f.path, cur); });
      blobCache.set(res.content.sha, f.content);
      const r: SavedFile = { path: f.path, sha: res.content.sha, commit: { sha: res.commit.sha, date: res.commit.committer?.date || res.commit.author?.date || new Date().toISOString() } };
      out.push(r);
      o.onSaved?.(r);
    }
    return out;
  });
}
