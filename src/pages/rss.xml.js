import rss from '@astrojs/rss';
import { site } from '../data/site';
import { livePosts, postTags, excerpt } from '../data/posts';

// Full posts (like Ghost/Substack feeds), with site-relative links and images
// made absolute so they work in feed readers. Drafts and scheduled posts are left out.
const absolutize = (html, origin) =>
  html.replace(/(\s(?:src|href|poster)=["'])\/(?!\/)/g, `$1${origin}/`).replace(/(\ssrcset=["'])([^"']*)/g, (_m, a, set) =>
    a + set.replace(/(^|,\s*)\/(?!\/)/g, `$1${origin}/`),
  );
const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export async function GET(context) {
  const origin = String(context.site).replace(/\/$/, '');
  const posts = await livePosts();
  return rss({
    title: `${site.short} · Blog`,
    description: site.description,
    site: context.site,
    xmlns: { atom: 'http://www.w3.org/2005/Atom', media: 'http://search.yahoo.com/mrss/', dc: 'http://purl.org/dc/elements/1.1/' },
    customData: [
      '<language>en-us</language>',
      `<atom:link href="${origin}/rss.xml" rel="self" type="application/rss+xml"/>`,
      posts[0] ? `<lastBuildDate>${new Date().toUTCString()}</lastBuildDate>` : '',
    ].join(''),
    items: posts.map((p) => {
      const cover = p.data.cover ? new URL(p.data.cover, context.site).href : null;
      const body = p.rendered?.html ? absolutize(p.rendered.html, origin) : '';
      return {
        title: p.data.title,
        description: p.data.description || excerpt(p.body),
        pubDate: p.data.date,
        link: `/blog/${p.id}/`,
        categories: postTags(p).map((t) => t.name),
        content: body ? (cover ? `<p><img src="${esc(cover)}" alt=""></p>` : '') + body : undefined,
        customData: `<dc:creator>${esc(site.name)}</dc:creator>` + (cover ? `<media:content url="${esc(cover)}" medium="image"/>` : ''),
      };
    }),
  });
}
