/**
 * Schema for the site text files in src/content/site/*.json (see CONTRACT.md §1).
 *
 * Plain TS, no Astro imports: used by the pages at build time (coerceFile) and by the
 * /write Site editor (inspector, defaults, validation). Key order in `fields` = key order
 * written to JSON.
 *
 * Extensions to the contract's Field type (all optional, safe to ignore):
 *   - every field: `default` (value used when an optional part is switched on / a required
 *     value is missing), `optional` (key may be absent)
 *   - plain: `format: 'email'`
 *   - object: `summary` (key used to label it in UI)
 */
import { isSafeUrl } from '../../lib/inline';

// ---------- types ----------

type Base = { label: string; help?: string; optional?: boolean; default?: unknown };
export type Field =
  | (Base & { type: 'plain' | 'inline'; required?: boolean; placeholder?: string; multiline?: false; format?: 'email' })
  | (Base & { type: 'url'; required?: boolean; allowRelative?: boolean; placeholder?: string })
  | (Base & { type: 'image'; required?: boolean; dir: string; alt?: string; keepAlpha?: boolean })
  | (Base & { type: 'number'; min?: number; max?: number; step?: number; default?: number })
  | (Base & { type: 'boolean' })
  | (Base & { type: 'select'; options: { value: string; label: string }[]; required?: boolean })
  | (Base & { type: 'object'; fields: Record<string, Field>; summary?: string })
  | (Base & { type: 'list'; itemLabel: string; item: Field; summary?: string; min?: number; max?: number; newItem: unknown });

export type SiteFileName = 'site' | 'home' | 'experience' | 'contact';
export type FileSchema = { label: string; fields: Record<string, Field> };

/** Shared link keys in site.json a home/contact link can point at ("email" → mailto:). */
export const SITE_LINK_KEYS = ['github', 'linkedin', 'x', 'email'] as const;
export type SiteLinkKey = (typeof SITE_LINK_KEYS)[number];

/** Pages a nav item can link to. */
export const PAGES = [
  { value: '/', label: 'Home' },
  { value: '/experience', label: 'Experience' },
  { value: '/blog', label: 'Blog' },
  { value: '/contact', label: 'Contact' },
];

/** Icons for project links (24×24 viewBox, filled with currentColor). */
export const linkIcons: Record<string, { label: string; path: string }> = {
  github: {
    label: 'GitHub',
    path: 'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12',
  },
  youtube: {
    label: 'YouTube',
    path: 'M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z',
  },
  pdf: {
    label: 'PDF',
    path: 'M6 2a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6H6zm7 1.5L18.5 9H13V3.5zM8 13h8v1.5H8V13zm0 3.5h8V18H8v-1.5zM8 9.5h3V11H8V9.5z',
  },
  globe: {
    label: 'Website',
    path: 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zm6.93 6h-2.95c-.32-1.25-.78-2.45-1.38-3.56 1.84.63 3.37 1.91 4.33 3.56zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14C4.1 13.36 4 12.69 4 12s.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2 0 .68.06 1.34.14 2H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56-1.84-.63-3.37-1.9-4.33-3.56zm2.95-8H5.08c.96-1.66 2.49-2.93 4.33-3.56C8.81 5.55 8.35 6.75 8.03 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66c-.09-.66-.16-1.32-.16-2 0-.68.07-1.35.16-2h4.68c.09.65.16 1.32.16 2 0 .68-.07 1.34-.16 2zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95c-.96 1.65-2.49 2.93-4.33 3.56zM16.36 14c.08-.66.14-1.32.14-2 0-.68-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2h-3.38z',
  },
  link: {
    label: 'Link',
    path: 'M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z',
  },
};
/** SVG path for an icon key (unknown keys get the generic link icon). */
export const iconPath = (key: string | undefined) => (linkIcons[key ?? ''] ?? linkIcons.link).path;

export const PLACEHOLDER_LOGO = '/site/placeholder-logo.svg';
export const PLACEHOLDER_IMAGE = '/site/placeholder-project.svg';
const SITE_DIR = 'public/site';

// ---------- reusable fields ----------

/** Home/contact link: a shared site link (site) or a custom URL (href, wins when non-empty). */
const siteLinkItem = (where: string): Field => ({
  type: 'object',
  label: 'Link',
  summary: 'label',
  help: `A link in the ${where} link row. Pick a shared site link, or enter a custom URL.`,
  fields: {
    label: { type: 'plain', label: 'Label', required: true, placeholder: 'GitHub' },
    site: {
      type: 'select',
      label: 'Site link',
      optional: true,
      options: [
        { value: 'github', label: 'GitHub' },
        { value: 'linkedin', label: 'LinkedIn' },
        { value: 'x', label: 'X / Twitter' },
        { value: 'email', label: 'Email' },
      ],
    },
    href: {
      type: 'url',
      label: 'Custom URL',
      optional: true,
      allowRelative: true,
      placeholder: 'https://',
      help: 'Used instead of the site link when set. Leave empty to use the site link.',
    },
  },
});
const newSiteLink = { label: 'Link', href: 'https://' };

// ---------- schema ----------

export const siteSchema: Record<SiteFileName, FileSchema> = {
  site: {
    label: 'Site (header, footer, shared links)',
    fields: {
      name: { type: 'plain', label: 'Full name', required: true, help: 'Shown in the footer and in search/social previews.' },
      short: { type: 'plain', label: 'Wordmark', required: true, help: 'The name at the top left of every page and in tab titles.' },
      description: { type: 'plain', label: 'Site description', required: true, help: 'Search engines and link previews show this.' },
      email: { type: 'plain', label: 'Email', required: true, format: 'email', placeholder: 'you@example.com' },
      github: { type: 'url', label: 'GitHub URL', required: true, placeholder: 'https://github.com/…' },
      linkedin: { type: 'url', label: 'LinkedIn URL', required: true, placeholder: 'https://www.linkedin.com/in/…' },
      x: { type: 'url', label: 'X / Twitter URL', required: true, placeholder: 'https://x.com/…' },
      nav: {
        type: 'list',
        label: 'Navigation',
        itemLabel: 'nav link',
        summary: 'label',
        min: 1,
        max: 6,
        help: 'Links at the top right of every page.',
        item: {
          type: 'object',
          label: 'Nav link',
          summary: 'label',
          fields: {
            href: { type: 'select', label: 'Page', required: true, options: PAGES },
            label: { type: 'plain', label: 'Label', required: true, placeholder: 'Page' },
          },
        },
        newItem: { href: '/', label: 'Link' },
      },
    },
  },
  home: {
    label: 'Home',
    fields: {
      heading: { type: 'plain', label: 'Heading', required: true },
      paragraphs: {
        type: 'list',
        label: 'Paragraphs',
        itemLabel: 'paragraph',
        max: 12,
        item: { type: 'inline', label: 'Paragraph', required: true, help: 'Supports **bold**, *italic* and [links](https://…).' },
        newItem: 'New paragraph.',
      },
      links: {
        type: 'list',
        label: 'Links',
        itemLabel: 'link',
        summary: 'label',
        max: 8,
        item: siteLinkItem('home page'),
        newItem: newSiteLink,
      },
    },
  },
  experience: {
    label: 'Experience',
    fields: {
      heading: { type: 'plain', label: 'Heading', required: true },
      jobs: {
        type: 'list',
        label: 'Jobs',
        itemLabel: 'job',
        summary: 'role',
        max: 40,
        item: {
          type: 'object',
          label: 'Job',
          summary: 'role',
          fields: {
            role: { type: 'plain', label: 'Role', required: true, placeholder: 'Software Engineering Intern' },
            org: { type: 'plain', label: 'Organization', required: true },
            href: { type: 'url', label: 'Role link', required: true, allowRelative: true, help: 'Where the role title links to.' },
            dates: { type: 'plain', label: 'Dates', required: true, placeholder: 'Jun. 2025 - Aug. 2025' },
            span: { type: 'plain', label: 'Duration', optional: true, placeholder: '3 mo', default: '3 mo', help: 'Shown as “(3 mo)” after the dates.' },
            place: { type: 'plain', label: 'Location', optional: true, placeholder: 'City, State, Country', default: 'City, State, Country' },
            logo: { type: 'image', label: 'Logo', optional: true, dir: SITE_DIR, keepAlpha: true, default: PLACEHOLDER_LOGO, help: 'Square-ish, transparent background works best.' },
          },
        },
        newItem: {
          role: 'New role',
          org: 'Organization',
          href: 'https://',
          dates: 'Jan. 2027 - Present',
          place: 'City, State, Country',
          logo: PLACEHOLDER_LOGO,
        },
      },
      projectsHeading: { type: 'plain', label: 'Projects heading', required: true },
      projects: {
        type: 'list',
        label: 'Projects',
        itemLabel: 'project',
        summary: 'project',
        max: 40,
        item: {
          type: 'object',
          label: 'Project',
          summary: 'project',
          fields: {
            event: { type: 'plain', label: 'Event / title', required: true, placeholder: 'Gemini 4 Argon Hackathon' },
            href: { type: 'url', label: 'Event link', required: true, allowRelative: true },
            host: { type: 'plain', label: 'Host', optional: true, placeholder: 'Host', default: 'Host', help: 'Shown after the project name: “Project · Host”.' },
            sponsor: {
              type: 'object',
              label: 'Sponsor logo',
              optional: true,
              default: { src: PLACEHOLDER_LOGO, alt: 'Sponsor', h: 24 },
              fields: {
                src: { type: 'image', label: 'Logo', required: true, dir: SITE_DIR, alt: 'alt', keepAlpha: true },
                alt: { type: 'plain', label: 'Alt text', required: true, help: 'Who the logo is, for screen readers.' },
                h: { type: 'number', label: 'Logo height (px)', min: 10, max: 48, step: 1, default: 24 },
                dark: { type: 'boolean', label: 'Dark backdrop', optional: true, help: 'Put the logo on a navy chip (for white logos).' },
              },
            },
            place: { type: 'plain', label: 'Result', required: true, placeholder: '1st Place', help: 'The handwritten text on the right, e.g. “1st Place”.' },
            project: { type: 'plain', label: 'Project name', required: true },
            pitch: { type: 'inline', label: 'Pitch', required: true, help: 'One or two sentences. Supports **bold**, *italic* and [links](https://…).' },
            badge: { type: 'plain', label: 'Badge', optional: true, placeholder: '$1k prize', default: 'Prize' },
            date: { type: 'plain', label: 'Year', required: true, placeholder: '2026' },
            image: {
              type: 'image',
              label: 'Image',
              optional: true,
              dir: SITE_DIR,
              default: PLACEHOLDER_IMAGE,
              help: 'Shown at 16:10 on the left. Takes precedence over the mock.',
            },
            mock: {
              type: 'object',
              label: 'Mini app mock',
              optional: true,
              help: 'A tiny chat-style UI drawn instead of an image (only shown when there is no image).',
              default: { message: 'Message', rows: [{ label: 'Label', value: 'Value' }], button: 'Button' },
              fields: {
                message: { type: 'plain', label: 'Message', required: true },
                rows: {
                  type: 'list',
                  label: 'Rows',
                  itemLabel: 'row',
                  summary: 'label',
                  max: 3,
                  item: {
                    type: 'object',
                    label: 'Row',
                    summary: 'label',
                    fields: {
                      label: { type: 'plain', label: 'Label', required: true },
                      value: { type: 'plain', label: 'Value', required: true },
                      pill: { type: 'boolean', label: 'Show value as a green pill', optional: true },
                    },
                  },
                  newItem: { label: 'Label', value: 'Value' },
                },
                button: { type: 'plain', label: 'Button', required: true },
              },
            },
            links: {
              type: 'list',
              label: 'Links',
              itemLabel: 'link',
              summary: 'label',
              max: 4,
              help: 'Icon buttons. The image links to the first one.',
              item: {
                type: 'object',
                label: 'Link',
                summary: 'label',
                fields: {
                  label: { type: 'plain', label: 'Label', required: true, help: 'Tooltip and screen-reader text.' },
                  icon: {
                    type: 'select',
                    label: 'Icon',
                    required: true,
                    default: 'link',
                    options: Object.entries(linkIcons).map(([value, { label }]) => ({ value, label })),
                  },
                  href: { type: 'url', label: 'URL', required: true, allowRelative: true },
                },
              },
              newItem: { label: 'Link', icon: 'link', href: 'https://' },
            },
          },
        },
        newItem: {
          event: 'Event name',
          href: 'https://',
          host: 'Host',
          sponsor: { src: PLACEHOLDER_LOGO, alt: 'Sponsor', h: 24 },
          place: '1st Place',
          project: 'Project',
          pitch: 'One-sentence pitch.',
          badge: 'Prize',
          date: '2027',
          image: PLACEHOLDER_IMAGE,
          links: [{ label: 'GitHub', icon: 'github', href: 'https://github.com/' }],
        },
      },
    },
  },
  contact: {
    label: 'Contact',
    fields: {
      heading: { type: 'plain', label: 'Heading', required: true },
      lead: { type: 'inline', label: 'Lead', required: true, help: 'Shown before your email address.' },
      links: {
        type: 'list',
        label: 'Links',
        itemLabel: 'link',
        summary: 'label',
        max: 8,
        item: siteLinkItem('contact page'),
        newItem: newSiteLink,
      },
    },
  },
};

// ---------- data types (what coerceFile returns) ----------

export type SiteLink = { label: string; site?: SiteLinkKey; href?: string };
export type NavItem = { href: string; label: string };
export type SiteData = { name: string; short: string; description: string; email: string; github: string; linkedin: string; x: string; nav: NavItem[] };
export type HomeData = { heading: string; paragraphs: string[]; links: SiteLink[] };
export type ContactData = { heading: string; lead: string; links: SiteLink[] };
export type Job = { role: string; org: string; href: string; dates: string; span?: string; place?: string; logo?: string };
export type Sponsor = { src: string; alt: string; h: number; dark?: boolean };
export type MockRow = { label: string; value: string; pill?: boolean };
export type Mock = { message: string; rows: MockRow[]; button: string };
export type ProjectLink = { label: string; icon: string; href: string };
export type Project = {
  event: string; href: string; host?: string; sponsor?: Sponsor; place: string; project: string; pitch: string;
  badge?: string; date: string; image?: string; mock?: Mock; links: ProjectLink[];
};
export type ExperienceData = { heading: string; jobs: Job[]; projectsHeading: string; projects: Project[] };
export type FileData = { site: SiteData; home: HomeData; experience: ExperienceData; contact: ContactData };

// ---------- helpers ----------

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const ptrSeg = (k: string | number) => String(k).replace(/~/g, '~0').replace(/\//g, '~1');

/** `href` attribute for a stored URL: unsafe/unfinished URLs (e.g. "https://") render as "#". */
export const hrefOf = (url: string | undefined) => (url && isSafeUrl(url) ? url : '#');

/**
 * Where a home/contact link goes, and which value the in-page URL editor edits:
 * custom `href` wins; else the shared site link (email → mailto:, not editable as a URL).
 */
export function resolveSiteLink(
  link: SiteLink,
  site: Pick<SiteData, 'email' | 'github' | 'linkedin' | 'x'>,
  pointer: string, // e.g. "home:/links/2"
): { href: string; editHref?: string } {
  if (link.href) return { href: hrefOf(link.href), editHref: `${pointer}/href` };
  if (link.site === 'email') return { href: `mailto:${site.email}` };
  if (link.site) return { href: hrefOf(site[link.site]), editHref: `site:/${link.site}` };
  return { href: '#', editHref: `${pointer}/href` };
}

/** Value used when an optional part is switched on (or a required one is missing). */
export function defaultFor(f: Field): unknown {
  if (f.default !== undefined) return clone(f.default);
  switch (f.type) {
    case 'plain':
    case 'inline':
    case 'url':
    case 'image':
      return '';
    case 'number':
      return f.min ?? 0;
    case 'boolean':
      return false;
    case 'select':
      return f.options[0]?.value ?? '';
    case 'list':
      return [];
    case 'object': {
      const o: Record<string, unknown> = {};
      for (const [k, sub] of Object.entries(f.fields)) if (!sub.optional) o[k] = defaultFor(sub);
      return o;
    }
  }
}

// ---------- coerce ----------

/** Coerce a value to a field; returns undefined to mean "leave the key out". */
function coerceField(f: Field, v: unknown): unknown {
  const missing = v === undefined || v === null;
  if (missing) return f.optional ? undefined : defaultFor(f);
  switch (f.type) {
    case 'plain':
    case 'inline':
    case 'url':
    case 'image': {
      if (typeof v === 'string') return v === '' && f.type === 'image' && f.optional ? undefined : v; // no image = absent
      if (typeof v === 'number' || typeof v === 'boolean') return String(v);
      return f.optional ? undefined : defaultFor(f);
    }
    case 'number': {
      let n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
      if (!Number.isFinite(n)) return f.optional ? undefined : defaultFor(f);
      if (f.min !== undefined) n = Math.max(f.min, n);
      if (f.max !== undefined) n = Math.min(f.max, n);
      return n;
    }
    case 'boolean':
      if (typeof v === 'boolean') return v;
      if (v === 'true') return true;
      if (v === 'false') return false;
      return f.optional ? undefined : false;
    case 'select': {
      const s = typeof v === 'string' ? v : String(v);
      if (f.options.some((o) => o.value === s)) return s;
      return f.optional ? undefined : defaultFor(f);
    }
    case 'object': {
      if (!isObj(v)) return f.optional ? undefined : defaultFor(f);
      return coerceObject(f.fields, v);
    }
    case 'list': {
      if (!Array.isArray(v)) return [];
      const out: unknown[] = [];
      for (const item of v) {
        if (item === null || item === undefined) continue;
        if (f.item.type === 'object' && !isObj(item)) continue; // junk entry
        const c = coerceField({ ...f.item, optional: false } as Field, item);
        if (c !== undefined) out.push(c);
      }
      return f.max !== undefined && out.length > f.max ? out.slice(0, f.max) : out;
    }
  }
}

function coerceObject(fields: Record<string, Field>, v: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, f] of Object.entries(fields)) {
    const c = coerceField(f, v[k]);
    if (c !== undefined) out[k] = c;
  }
  return out;
}

/**
 * A safe, renderable copy of a file's data: missing required values filled with defaults,
 * wrong types fixed or dropped, unknown keys dropped, key order = schema order.
 * Never throws and never mutates `data`. Unknown file names return `data` unchanged.
 */
export function coerceFile<K extends SiteFileName>(file: K, data: unknown): FileData[K];
export function coerceFile(file: string, data: unknown): unknown;
export function coerceFile(file: string, data: unknown): unknown {
  try {
    const s = (siteSchema as Record<string, FileSchema>)[file];
    if (!s) return data;
    let out = coerceObject(s.fields, isObj(data) ? data : {});
    if (file === 'home' || file === 'contact') {
      // a link needs somewhere to go: drop a non-string href, keep the item (validation reports it)
      out = { ...out, links: (out.links as SiteLink[]).map((l) => (l.href === '' && l.site ? { label: l.label, site: l.site } : l)) };
    }
    return out;
  } catch {
    return data;
  }
}

// ---------- validate ----------

const EMAIL_RE = /^[^\s@<>()"]+@[^\s@<>()"]+\.[^\s@<>()"]+$/;

function checkUrl(v: string, allowRelative: boolean): string | null {
  if (!isSafeUrl(v)) return 'Enter a full URL starting with https://' + (allowRelative ? ' (or a site path like /papers/x.pdf)' : '') + '.';
  if (!allowRelative && v.startsWith('/')) return 'Enter a full URL starting with https://.';
  if (/^https?:\/\/[^/]*$/i.test(v) && !/^https?:\/\/[^/.]+\.[^/]+/i.test(v)) return 'This URL looks incomplete.';
  return null;
}

type Issue = { path: string; message: string };

function validateField(f: Field, v: unknown, path: string, out: Issue[]) {
  const label = f.label;
  if (v === undefined || v === null) {
    if (!f.optional && f.type !== 'boolean' && f.type !== 'list' && !(f.type === 'number' && f.default !== undefined))
      out.push({ path, message: `${label} is missing.` });
    return;
  }
  switch (f.type) {
    case 'plain':
    case 'inline': {
      if (typeof v !== 'string') return void out.push({ path, message: `${label} should be text.` });
      if (f.required && !v.trim()) return void out.push({ path, message: `${label} can’t be empty.` });
      if (f.format === 'email' && v.trim() && !EMAIL_RE.test(v.trim())) out.push({ path, message: `${label} doesn’t look like an email address.` });
      return;
    }
    case 'url': {
      if (typeof v !== 'string') return void out.push({ path, message: `${label} should be a URL.` });
      if (!v.trim()) {
        if (f.required) out.push({ path, message: `${label} can’t be empty.` });
        return;
      }
      const m = checkUrl(v, !!f.allowRelative);
      if (m) out.push({ path, message: `${label}: ${m}` });
      return;
    }
    case 'image': {
      if (typeof v !== 'string') return void out.push({ path, message: `${label} should be an image path.` });
      if (!v.trim()) {
        if (f.required) out.push({ path, message: `${label}: choose an image.` });
        return;
      }
      if (!isSafeUrl(v)) out.push({ path, message: `${label}: use an uploaded image (a /path on this site) or an https:// URL.` });
      return;
    }
    case 'number': {
      if (typeof v !== 'number' || !Number.isFinite(v)) return void out.push({ path, message: `${label} should be a number.` });
      if (f.min !== undefined && v < f.min) out.push({ path, message: `${label} must be at least ${f.min}.` });
      if (f.max !== undefined && v > f.max) out.push({ path, message: `${label} must be at most ${f.max}.` });
      return;
    }
    case 'boolean':
      if (typeof v !== 'boolean') out.push({ path, message: `${label} should be on or off.` });
      return;
    case 'select':
      if (typeof v !== 'string' || !f.options.some((o) => o.value === v))
        out.push({ path, message: `${label}: choose one of ${f.options.map((o) => o.label).join(', ')}.` });
      return;
    case 'object': {
      if (!isObj(v)) return void out.push({ path, message: `${label} is malformed.` });
      for (const [k, sub] of Object.entries(f.fields)) validateField(sub, v[k], `${path}/${ptrSeg(k)}`, out);
      return;
    }
    case 'list': {
      if (!Array.isArray(v)) return void out.push({ path, message: `${label} should be a list.` });
      if (f.min !== undefined && v.length < f.min) out.push({ path, message: `${label}: add at least ${f.min} ${f.itemLabel}${f.min === 1 ? '' : 's'}.` });
      if (f.max !== undefined && v.length > f.max) out.push({ path, message: `${label}: at most ${f.max} ${f.itemLabel}s.` });
      const item = { ...f.item, optional: false } as Field;
      v.forEach((x, i) => validateField(item, x, `${path}/${i}`, out));
      return;
    }
  }
}

/** Problems that should block publishing, as JSON pointers into the file ("/jobs/2/href"). Never throws. */
export function validateFile(file: string, data: unknown): { path: string; message: string }[] {
  const out: Issue[] = [];
  try {
    const s = (siteSchema as Record<string, FileSchema>)[file];
    if (!s) return [{ path: '', message: `Unknown site file “${file}”.` }];
    if (!isObj(data)) return [{ path: '', message: `${s.label}: the file isn’t a JSON object.` }];
    for (const [k, f] of Object.entries(s.fields)) validateField(f, data[k], `/${ptrSeg(k)}`, out);
    if ((file === 'home' || file === 'contact') && Array.isArray(data.links)) {
      data.links.forEach((l, i) => {
        if (isObj(l) && !l.site && (typeof l.href !== 'string' || !l.href.trim()))
          out.push({ path: `/links/${i}/href`, message: 'Link: choose a site link or enter a custom URL.' });
      });
    }
  } catch (e) {
    out.push({ path: '', message: `Couldn’t check this file (${(e as Error)?.message ?? e}).` });
  }
  return out;
}

/** The schema field at a JSON pointer inside a file ("/projects/0/links/1/icon"), or null. */
export function fieldAt(file: string, pointer: string): Field | null {
  const s = (siteSchema as Record<string, FileSchema>)[file];
  if (!s) return null;
  const segs = pointer.split('/').slice(1).map((x) => x.replace(/~1/g, '/').replace(/~0/g, '~'));
  let f: Field | null = { type: 'object', label: s.label, fields: s.fields };
  for (const seg of segs) {
    if (!f) return null;
    if (f.type === 'object') f = f.fields[seg] ?? null;
    else if (f.type === 'list') f = /^(\d+|__[ij]__)$/.test(seg) ? f.item : null;
    else return null;
  }
  return f;
}

/** The `newItem` of the list at a pointer ("/projects", "/projects/0/links"), deep-copied. */
export function newItemFor(file: string, listPointer: string): unknown {
  const f = fieldAt(file, listPointer);
  return f && f.type === 'list' ? clone(f.newItem) : undefined;
}

/** Default for the optional/required field at a pointer (what a hidden optional part renders). */
export function defaultAt(file: string, pointer: string): unknown {
  const f = fieldAt(file, pointer);
  return f ? defaultFor(f) : undefined;
}
