// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
// Astro 7's default Markdown processor (used here to add the figure plugin).
import { satteri } from '@astrojs/markdown-satteri';
import { figurePlugin } from './src/plugins/figure.mjs';
import { quotePlugin } from './src/plugins/quote.mjs';

// Drafts and scheduled posts are built under /blog/draft/ (see src/data/posts.ts),
// so leaving that folder out keeps them out of the sitemap.

export default defineConfig({
  site: 'https://benxie.garden',
  integrations: [sitemap({ filter: (page) => !page.includes('/blog/draft/') && !page.includes('/write') })],
  markdown: {
    // ![alt](src "caption") alone in a paragraph → <figure><img><figcaption>; quote source lines
    processor: satteri({ hastPlugins: [figurePlugin, quotePlugin] }),
    // calm, light code highlighting on the paper background (background overridden in post.css)
    shikiConfig: { theme: 'github-light' },
  },
});
