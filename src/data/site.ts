// Shared site info. The text lives in src/content/site/site.json (editable from /write);
// this module keeps the `site` and `nav` exports the rest of the code uses.
import data from '../content/site/site.json';
import { loadSiteFile } from '../lib/site-content';
import { resolveSiteLink, type NavItem, type SiteLink } from '../content/site/schema';

const file = loadSiteFile('site', data);

export const site = {
  name: file.name,
  short: file.short,
  description: file.description,
  email: file.email,
  github: file.github,
  linkedin: file.linkedin,
  x: file.x,
  /** A post dated in the future goes live on that day in this time zone (see src/data/posts.ts). */
  timeZone: 'America/Los_Angeles',
};

export const nav: NavItem[] = file.nav;

/** URL for a shared link key used by the pages ("github", "linkedin", "x" or "email"). */
export const siteLink = (key: string) =>
  key === 'email' ? `mailto:${site.email}` : (site as Record<string, string>)[key];

/** href + in-page URL-editor pointer for a home/contact link item (custom href or shared site link). */
export const linkTarget = (link: SiteLink, pointer: string) => resolveSiteLink(link, site, pointer);
