import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Blog posts: Markdown files in src/content/blog (written in Pages CMS or by hand).
const blog = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional().default(''),
    date: z.coerce.date(),
    cover: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { blog };
