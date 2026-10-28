// Which blog posts are public, plus small helpers shared by the blog pages,
// RSS and tag pages. Decided at build time (not in the content schema, whose
// results are cached between builds).
//
// - draft: true            → unlisted preview at /blog/draft/<slug>, noindex
// - date in the future     → "scheduled": same as a draft until that day
//                            (in site.timeZone); the daily deploy publishes it
// - otherwise              → live at /blog/<slug>
import { getCollection, type CollectionEntry } from 'astro:content';
import { site } from './site';

export type Post = CollectionEntry<'blog'>;

const ymd = (d: Date) => d.toISOString().slice(0, 10);
/** Today (YYYY-MM-DD) where Ben lives. BLOG_TODAY=YYYY-MM-DD overrides it (for testing). */
export const siteToday = () => process.env.BLOG_TODAY || new Date().toLocaleDateString('en-CA', { timeZone: site.timeZone });

export const isScheduled = (p: Post) => !p.data.draft && ymd(p.data.date) > siteToday();
export const isLive = (p: Post) => !p.data.draft && !isScheduled(p);
/** Route slug: live posts at /blog/<slug>, drafts and scheduled posts at /blog/draft/<slug>. */
export const routeOf = (p: Post) => (isLive(p) ? p.id : `draft/${p.id}`);
export const urlOf = (p: Post) => `/blog/${routeOf(p)}/`;

const byDate = (a: Post, b: Post) => b.data.date.valueOf() - a.data.date.valueOf() || a.id.localeCompare(b.id);
/** Live posts, newest first. */
export async function livePosts() {
  return (await getCollection('blog', isLive)).sort(byDate);
}

/** 'Energy Policy' → 'energy-policy' (the /blog/tags/<slug> address). */
export const tagSlug = (t: string) =>
  t.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'tag';

export type Tag = { slug: string; name: string; posts: Post[] };
/** Tags used by live posts, most used first. A tag's name is its most recent spelling. */
export function tagsOf(posts: Post[]): Tag[] {
  const map = new Map<string, Tag>();
  for (const p of posts)
    for (const name of p.data.tags) {
      const slug = tagSlug(name);
      const t = map.get(slug) ?? { slug, name, posts: [] };
      if (!t.posts.includes(p)) t.posts.push(p);
      map.set(slug, t);
    }
  return [...map.values()].sort((a, b) => b.posts.length - a.posts.length || a.name.localeCompare(b.name));
}
/** A post's tags without case/spelling duplicates. */
export const postTags = (p: Post) => {
  const seen = new Set<string>();
  return p.data.tags.filter((t) => !seen.has(tagSlug(t)) && seen.add(tagSlug(t))).map((name) => ({ name, slug: tagSlug(name) }));
};

/** Minutes to read the Markdown body (~230 words a minute; images count a little). */
export function readingMinutes(body = '') {
  const text = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ');
  const words = (text.match(/[\p{L}\p{N}’']+/gu) || []).length;
  const images = (body.match(/!\[[^\]]*\]\(/g) || []).length;
  return Math.max(1, Math.round(words / 230 + images * 0.1));
}

export const fmtDate = (d: Date, month: 'short' | 'long' = 'short') =>
  d.toLocaleDateString('en-US', { month, day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** Plain-text opening of the post (~`max` chars, cut at a word) for previews when there's no summary. */
export function excerpt(body = '', max = 160) {
  const para = body
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .find((b) => b && !/^(#|!\[|```|>|<|[-*+] |\d+\. |---|\||:::)/.test(b));
  if (!para) return '';
  const text = para
    .replace(/\[\^[^\]]*\]/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]+/g, '')
    .replace(/\\(.)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  return text.slice(0, max).replace(/\s+\S*$/, '').replace(/[,;:.\s]+$/, '') + '…';
}
