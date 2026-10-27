// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://benjaminxie1.github.io',
  integrations: [sitemap()],
});
