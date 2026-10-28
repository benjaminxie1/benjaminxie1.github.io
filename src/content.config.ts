import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';

// Blog posts: Markdown files in src/content/blog (written in /write or by hand).
// A post with a broken field must not break the whole site build: bad values fall
// back (with a build warning) and a post without a usable title or date is
// demoted to an unlisted draft instead of failing.
const warn = (field: string, input: unknown) => console.warn(`[blog] ignoring invalid ${field}: ${JSON.stringify(input)}`);
const blog = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/blog' }),
  schema: z
    .object({
      title: z.string().min(1).catch((c) => (warn('title', c.input), '')),
      description: z.string().optional().default('').catch((c) => (warn('description', c.input), '')),
      date: z.coerce.date().refine((d) => !isNaN(+d)).nullable().catch((c) => (warn('date', c.input), null)),
      cover: z.string().optional().catch((c) => (warn('cover', c.input), undefined)),
      draft: z.boolean().default(false).catch((c) => (warn('draft (treating as draft)', c.input), true)),
      // `updated: YYYY-MM-DD`, set by /write when a live post is edited
      updated: z.coerce.date().refine((d) => !isNaN(+d)).optional().catch((c) => (warn('updated', c.input), undefined)),
      // `tags: [energy, hackathons]` (a single string is accepted too)
      tags: z
        .union([z.array(z.unknown()), z.string()])
        .optional()
        .catch((c) => (warn('tags', c.input), undefined)),
    })
    .transform((d) => ({
      ...d,
      title: d.title || 'Untitled',
      draft: d.draft || !d.title || d.date === null,
      date: d.date ?? new Date(0),
      tags: [
        ...new Set(
          (typeof d.tags === 'string' ? d.tags.split(',') : (d.tags ?? []))
            .map((t) => (t instanceof Date ? t.toISOString().slice(0, 10) : typeof t === 'string' || typeof t === 'number' ? String(t).trim() : ''))
            .filter(Boolean),
        ),
      ],
    })),
});

export const collections = { blog };
