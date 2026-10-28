// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
// Astro 7's default Markdown processor. It ships with astro (exact-pinned
// dependency, hoisted to node_modules/@astrojs/markdown-satteri in the lockfile).
import { satteri } from '@astrojs/markdown-satteri';
import { figurePlugin } from './src/plugins/figure.mjs';

export default defineConfig({
  site: 'https://benxie.garden',
  integrations: [sitemap({ filter: (page) => !page.includes('/blog/draft/') && !page.includes('/write') })],
  markdown: {
    // ![alt](src "caption") alone in a paragraph → <figure><img><figcaption>
    processor: satteri({ hastPlugins: [figurePlugin] }),
    // calm, light code highlighting on the paper background (background overridden in post.css)
    shikiConfig: { theme: 'github-light' },
  },
});
