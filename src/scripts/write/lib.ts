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
};
export const today = () => new Date().toLocaleDateString('en-CA');
export const blank = (): Doc => ({ path: null, sha: null, title: '', description: '', date: today(), cover: '', draft: true, published: false, html: '' });

// ---------- paths: images display from GitHub raw until the site redeploys ----------
export const toDisplay = (src: string) => (src.startsWith('/blog/') ? RAW + src.slice(6) : src);
export const toSite = (src: string) => (src.startsWith(RAW) ? '/blog/' + src.slice(RAW.length) : src);

export const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70);
export const slugOf = (d: Doc) => (d.path ? d.path.split('/').pop()!.replace(/\.mdx?$/, '') : slugify(d.title));

