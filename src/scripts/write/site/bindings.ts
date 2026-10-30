// Live preview of details that aren't text, src/alt or optional parts, driven only by the
// page's markers (CONTRACT.md §2 "As implemented"): data-edit-attr, data-edit-class,
// data-edit-style, data-edit-icon and data-edit-sitelink. Same rules as the reference fill
// in tests/site-templates.test.mjs.
import { hrefOf, iconPath, resolveSiteLink, defaultAt } from '../../../content/site/schema';
import { parseKey, tokens, join, type Key } from './pointer';

export type BindCtx = { get(k: Key): unknown };

const setAttr = (el: Element, a: string, v: string | null | undefined) => {
  if (v == null) { if (el.hasAttribute(a)) el.removeAttribute(a); }
  else if (el.getAttribute(a) !== v) el.setAttribute(a, v);
};
const pairs = (s: string) => s.split(/\s+/).filter(Boolean).map((b) => { const i = b.indexOf('='); return [b.slice(0, i), b.slice(i + 1)] as const; });

export function applyBindings(doc: Document, c: BindCtx) {
  // the value, or what a hidden optional part shows for it (its default)
  const val = (k: Key): unknown => {
    const p = parseKey(k);
    if (!p) return undefined;
    const v = c.get(k);
    if (v !== undefined) return v;
    let path = '', cur: unknown;
    for (const t of tokens(p.ptr)) { path = join(path, t); const x = c.get(`${p.file}:${path}`); cur = x !== undefined ? x : defaultAt(p.file, path); }
    return cur;
  };
  const loaded = (k: string) => { const p = parseKey(k); return !!p && c.get(`${p.file}:`) !== undefined; };
  const sel = '[data-edit-attr], [data-edit-class], [data-edit-style], [data-edit-icon], [data-edit-sitelink]';
  for (const el of doc.querySelectorAll<HTMLElement>(sel)) {
    const d = el.dataset;
    try {
      if (d.editSitelink && loaded(d.editSitelink)) {
        const link = c.get(d.editSitelink);
        const site = c.get('site:') as Parameters<typeof resolveSiteLink>[1] | undefined;
        if (link && typeof link === 'object' && site) {
          const t = resolveSiteLink(link as Parameters<typeof resolveSiteLink>[0], site, d.editSitelink);
          setAttr(el, 'href', t.href);
          setAttr(el, 'data-edit-href', t.editHref ?? null);
        }
      }
      if (d.editAttr) for (const [attr, ptrs] of pairs(d.editAttr)) {
        if (!ptrs.split('|').every(loaded)) continue;
        let v: unknown = ptrs.split('|').map((p) => c.get(p)).find((x) => x !== undefined && x !== '');
        if (attr === 'href') v = hrefOf(v as string | undefined);
        setAttr(el, attr, v === undefined ? null : String(v));
      }
      if (d.editClass) for (const [cls, p] of pairs(d.editClass)) {
        const neg = p.startsWith('!'), k = neg ? p.slice(1) : p;
        if (!loaded(k)) continue;
        const on = neg ? !val(k) : !!val(k);
        if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
      }
      if (d.editStyle) for (const [prop, p] of pairs(d.editStyle)) {
        if (!loaded(p)) continue;
        const v = val(p);
        const s = typeof v === 'number' ? `${v}px` : v == null ? '' : String(v);
        if (el.style.getPropertyValue(prop) !== s) el.style.setProperty(prop, s);
      }
      if (d.editIcon && loaded(d.editIcon)) setAttr(el, 'd', iconPath(val(d.editIcon) as string | undefined));
    } catch {}
  }
}
