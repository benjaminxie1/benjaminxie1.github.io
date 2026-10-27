# benjaminxie1.github.io

Personal site for Benjamin Xie, built with [Astro](https://astro.build).

The landing page is an animated ASCII willow over a pond (`src/components/WillowPond.astro`); everything else is plain, minimal pages.

## Develop

```sh
npm install
npm run dev      # http://localhost:4321
npm run build    # static output in dist/
```

## Where things live

| What | Where |
| --- | --- |
| Name, links, nav | `src/data/site.ts` |
| Projects | `src/data/projects.ts` |
| About page (experience, awards) | `src/pages/about.astro` |
| Blog posts | `src/content/blog/*.md` (frontmatter: `title`, `description`, `date`, optional `draft: true`) |
| Colors, type | `src/styles/global.css` |
| Willow / pond art | `src/components/WillowPond.astro` |

To write a post, add a Markdown file to `src/content/blog/` and push.

## Deploy

`.github/workflows/deploy.yml` builds and deploys to GitHub Pages on every push to `main`.
One-time setup: repo **Settings → Pages → Source: GitHub Actions**.

For a custom domain later, add it under Settings → Pages and set `site` in `astro.config.mjs`.
