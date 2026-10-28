// Shared config, storage and document model for the /write editor.
export const OWNER = 'benjaminxie1';
export const REPO = 'benjaminxie1.github.io';
export const BRANCH = 'main';
export const POSTS_DIR = 'src/content/blog';
export const MEDIA_DIR = 'public/blog';
export const RAW = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${MEDIA_DIR}/`;
export const LOCAL_KEY = 'bx-write:doc';
export const TOKEN_KEY = 'bx-write:token';

export const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector(s) as T;
export const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  del(k: string) { try { localStorage.removeItem(k); } catch {} },
};

// ---------- document state ----------
export type Doc = {
  path: string | null; // file in repo once saved
  sha: string | null;
  title: string;
  description: string;
  date: string; // YYYY-MM-DD
  cover: string; // site path (/blog/x.webp) or ''
  draft: boolean; // status in the repo
  published: boolean; // whether the repo copy is live
  html: string;
  slug?: string; // desired slug for a not-yet-saved post
  extra?: Record<string, unknown>; // unknown frontmatter keys, preserved on save
  localId?: string; // stable id for a never-saved doc (local draft key 'new:<localId>'), set by local.keyOf
  dateRaw?: string; // the frontmatter date exactly as found; written back unchanged if `date` wasn't edited
  lastCommit?: { sha: string; date: string }; // set by savePost: the commit it made (feed to deployStatus)
};
export const today = () => new Date().toLocaleDateString('en-CA');
export const blank = (): Doc => ({ path: null, sha: null, title: '', description: '', date: today(), cover: '', draft: true, published: false, html: '' });

// ---------- paths: images display from GitHub raw until the site redeploys ----------
const RAW_ROOT = `https://raw.githubusercontent.com/${OWNER}/${REPO}/`;
const SITE_ORIGINS = ['https://benxie.garden', 'http://benxie.garden', 'https://www.benxie.garden', `https://${OWNER}.github.io`];
/** Site path ('/blog/x.webp', '/img/y.png', or a full benxie.garden URL) → a URL that loads right now. */
export const toDisplay = (src: string) => {
  if (!src) return src;
  for (const o of SITE_ORIGINS) if (src.startsWith(o + '/')) { src = src.slice(o.length); break; }
  if (src.startsWith('/blog/')) return RAW + src.slice(6);
  // other root-relative site paths are files under public/
  if (src.startsWith('/') && !src.startsWith('//')) return `${RAW_ROOT}${BRANCH}/public${src}`;
  return src;
};
/** Inverse of toDisplay: raw.githubusercontent / site-origin URLs → site path. Other URLs unchanged. */
export const toSite = (src: string) => {
  if (!src) return src;
  if (src.startsWith(RAW)) return '/blog/' + src.slice(RAW.length);
  if (src.startsWith(RAW_ROOT)) {
    // https://raw.githubusercontent.com/O/R/<any ref>/public/<path>
    const m = src.slice(RAW_ROOT.length).match(/^[^/]+\/public(\/.+)$/);
    if (m) return m[1];
  }
  for (const o of SITE_ORIGINS) if (src.startsWith(o + '/')) return src.slice(o.length);
  return src;
};

const FOLD: Record<string, string> = { ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', đ: 'd', ð: 'd', þ: 'th', ł: 'l', ı: 'i', '&': ' and ' };
/**
 * URL slug from a title. Max 70 chars, never a leading/trailing '-'. When nothing
 * Latin is left (e.g. a title in Chinese or only emoji), returns `fallback`
 * (default 'post-YYYY-MM-DD'). Pass fallback '' to get '' instead.
 */
export const slugify = (s: string, fallback?: string) => {
  let out = (s || '')
    .toLowerCase()
    .replace(/[ßæœøđðþłı&]/g, (c) => FOLD[c])
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (out.length > 70) {
    out = out.slice(0, 70);
    // prefer cutting at a word boundary if one is reasonably close
    const cut = out.lastIndexOf('-');
    if (cut > 40) out = out.slice(0, cut);
    out = out.replace(/-+$/g, '');
  }
  return out || (fallback ?? `post-${today()}`);
};
export const slugOf = (d: Doc) => (d.path ? d.path.split('/').pop()!.replace(/\.mdx?$/, '') : d.slug ? slugify(d.slug) : slugify(d.title));
