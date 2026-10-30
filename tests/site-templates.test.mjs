// Checks the /write Site editor markers on the built pages (src/content/site/CONTRACT.md §2):
// for every list, its <template> instantiated at an item's index and filled from the data
// (the way the editor does it: replace __i__/__j__, renderInline for text, markers for the rest)
// gives exactly the markup of the real item; the template at index N filled with the schema's
// newItem gives the template itself; and every pointer on the page resolves in the schema.
//
//   npx astro build && (cd dist && python3 -m http.server 4750) &
//   NODE_PATH=<global node_modules> node tests/site-templates.test.mjs [baseUrl]
//
// Reads the JSON from src/content/site (it must be the data the build used).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv[2] || 'http://localhost:4750';
const bundle = execFileSync(
  'npx',
  ['esbuild', '--bundle', '--format=iife', '--global-name=SITE', '--log-level=warning'],
  { cwd: root, input: "export * from './src/content/site/schema'; export { renderInline } from './src/lib/inline';" },
).toString();
const raw = Object.fromEntries(['site', 'home', 'experience', 'contact'].map((f) => [f, JSON.parse(readFileSync(join(root, 'src/content/site', f + '.json'), 'utf8'))]));

// Runs in the page. Returns a list of problems (strings) and some counts.
function check({ raw }) {
  const S = window.SITE;
  const files = Object.fromEntries(Object.entries(raw).map(([f, d]) => [f, S.coerceFile(f, d)]));
  const problems = [];
  const counts = { lists: 0, items: 0, templates: 0, pointers: 0 };
  const split = (p) => { const i = p.indexOf(':'); return [p.slice(0, i), p.slice(i + 1)]; };
  const segs = (ptr) => ptr.split('/').slice(1).map((x) => x.replace(/~1/g, '/').replace(/~0/g, '~'));
  const get = (data, p) => {
    const [f, ptr] = split(p);
    let cur = data[f];
    for (const s of segs(ptr)) { if (cur == null || typeof cur !== 'object') return undefined; cur = cur[s]; }
    return cur;
  };
  // value, or what the page shows for it when it (or an ancestor optional part) is absent
  const val = (data, p) => {
    const [f, ptr] = split(p);
    let cur = data[f], path = '';
    for (const s of segs(ptr)) {
      path += '/' + s;
      const next = cur && typeof cur === 'object' ? cur[s] : undefined;
      cur = next !== undefined ? next : S.defaultAt(f, path);
    }
    return cur;
  };
  const tokenOf = (listPtr) => (/\/\d+(\/|$)/.test(split(listPtr)[1]) ? '__j__' : '__i__');
  const instantiate = (tpl, token, k) => {
    const t = document.createElement('template');
    t.innerHTML = tpl.innerHTML.split(token).join(String(k)).trim();
    if (t.content.children.length !== 1) problems.push(`template ${tpl.dataset.editTemplate} has ${t.content.children.length} root elements`);
    return t.content.firstElementChild;
  };
  const templateFor = (list) => {
    const p = list.dataset.editList;
    const all = [...document.querySelectorAll('template')].flatMap((t) => [t, ...t.content.querySelectorAll('template')]);
    const here = list.parentElement.querySelector(`:scope > template[data-edit-template="${CSS.escape(p)}"]`);
    return here || [...document.querySelectorAll(`template[data-edit-template="${CSS.escape(p)}"]`)][0] || all.find((t) => t.dataset.editTemplate === p);
  };
  // The editor's "apply data to this subtree", driven only by markers.
  const fill = (rootEl, data) => {
    for (const list of rootEl.querySelectorAll('[data-edit-list]')) {
      const p = list.dataset.editList;
      const tpl = list.parentElement.querySelector(`:scope > template[data-edit-template="${CSS.escape(p)}"]`);
      if (!tpl) { problems.push(`nested list ${p}: no sibling template`); continue; }
      const arr = val(data, p) || [];
      list.replaceChildren(...arr.map((_, k) => instantiate(tpl, tokenOf(p), k)));
    }
    for (const el of [rootEl, ...rootEl.querySelectorAll('*')]) {
      const d = el.dataset;
      if (d.editOptional) el.hidden = get(data, d.editOptional) === undefined;
      if (d.edit) {
        const v = val(data, d.edit) ?? '';
        if (d.editKind === 'inline') el.innerHTML = S.renderInline(v); else el.textContent = v;
      }
      if (d.editSitelink) {
        const [f, ptr] = split(d.editSitelink);
        const t = S.resolveSiteLink(get(data, d.editSitelink), data.site, d.editSitelink);
        el.setAttribute('href', t.href);
        if (t.editHref) el.setAttribute('data-edit-href', t.editHref); else el.removeAttribute('data-edit-href');
      } else if (d.editHref && el.tagName === 'A') el.setAttribute('href', S.hrefOf(val(data, d.editHref)));
      if (d.editImg) el.setAttribute('src', val(data, d.editImg));
      if (d.editAlt) el.setAttribute('alt', val(data, d.editAlt) ?? '');
      if (d.editAttr) for (const b of d.editAttr.split(' ')) {
        const [attr, ptrs] = [b.slice(0, b.indexOf('=')), b.slice(b.indexOf('=') + 1)];
        let v = ptrs.split('|').map((p) => get(data, p)).find((x) => x !== undefined && x !== '');
        if (attr === 'href') v = S.hrefOf(v);
        if (v === undefined) el.removeAttribute(attr); else el.setAttribute(attr, String(v));
      }
      if (d.editClass) for (const b of d.editClass.split(' ')) {
        const [cls, p] = [b.slice(0, b.indexOf('=')), b.slice(b.indexOf('=') + 1)];
        const neg = p.startsWith('!');
        el.classList.toggle(cls, neg ? !val(data, p.slice(1)) : !!val(data, p));
      }
      if (d.editStyle) for (const b of d.editStyle.split(' ')) {
        const [prop, p] = [b.slice(0, b.indexOf('=')), b.slice(b.indexOf('=') + 1)];
        const v = val(data, p);
        el.style.setProperty(prop, typeof v === 'number' ? `${v}px` : String(v));
      }
      if (d.editIcon) el.setAttribute('d', S.iconPath(val(data, d.editIcon)));
    }
    return rootEl;
  };
  const canon = (n) => {
    if (n.nodeType === 3) return n.nodeValue.replace(/\s+/g, ' ');
    if (n.nodeType !== 1) return '';
    const attrs = [...n.attributes]
      .filter((a) => a.name !== 'aria-label' && a.name !== 'aria-current')
      .map((a) => [a.name, a.name === 'style' ? n.style.cssText : a.value])
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${k}="${v}"`).join(' ');
    const kids = n.tagName === 'TEMPLATE' ? n.content.childNodes : n.childNodes;
    return `<${n.tagName.toLowerCase()} ${attrs}>${[...kids].map(canon).join('')}</${n.tagName.toLowerCase()}>`;
  };

  // every pointer resolves in the schema
  const ptrAttrs = ['edit', 'editHref', 'editItem', 'editList', 'editTemplate', 'editImg', 'editAlt', 'editOptional', 'editIcon', 'editSitelink'];
  const scan = (nodes) => {
    for (const el of nodes) {
      for (const a of ptrAttrs) if (el.dataset[a]) {
        counts.pointers++;
        const [f, ptr] = split(el.dataset[a]);
        if (!S.fieldAt(f, ptr)) problems.push(`no schema field for ${a}="${el.dataset[a]}"`);
      }
      for (const a of ['editAttr', 'editClass', 'editStyle']) if (el.dataset[a])
        for (const b of el.dataset[a].split(' ')) for (const p of b.slice(b.indexOf('=') + 1).replace(/^!/, '').split('|')) {
          counts.pointers++;
          const [f, ptr] = split(p);
          if (!S.fieldAt(f, ptr)) problems.push(`no schema field for ${a} ${p}`);
        }
      if (el.tagName === 'TEMPLATE') scan(el.content.querySelectorAll('*'));
    }
  };
  scan(document.querySelectorAll('*'));

  for (const list of document.querySelectorAll('[data-edit-list]')) {
    counts.lists++;
    const p = list.dataset.editList;
    const tpl = templateFor(list);
    if (!tpl) { problems.push(`list ${p}: no template`); continue; }
    if (document.querySelectorAll(`template[data-edit-template="${CSS.escape(p)}"]`).length !== 1) problems.push(`list ${p}: not exactly one template`);
    const arr = get(files, p);
    const optionalAncestor = list.closest('[data-edit-optional]');
    const expected = arr ?? (optionalAncestor ? val(files, p) : undefined);
    if (!Array.isArray(expected)) { problems.push(`list ${p}: data is not an array`); continue; }
    const kids = [...list.children];
    if (kids.some((k) => !k.dataset.editItem)) problems.push(`list ${p}: has non-item children`);
    if (kids.length !== expected.length) problems.push(`list ${p}: ${kids.length} items, data has ${expected.length}`);
    const token = tokenOf(p);
    kids.forEach((item, k) => {
      counts.items++;
      if (item.dataset.editItem !== `${p}/${k}`) problems.push(`${p}: item ${k} is ${item.dataset.editItem}`);
      const made = fill(instantiate(tpl, token, k), files);
      if (canon(made) !== canon(item)) problems.push(`${p}/${k}: template ≠ real item\n  real: ${canon(item).slice(0, 4000)}\n  tmpl: ${canon(made).slice(0, 4000)}`);
    });
    // the template shows the schema's newItem: filling it with newItem changes nothing
    counts.templates++;
    const [f, ptr] = split(p);
    const withNew = JSON.parse(JSON.stringify(files));
    let target = withNew[f]; let path = '';
    for (const s of segs(ptr)) {
      path += '/' + s;
      if (target[s] === undefined) target[s] = S.defaultAt(f, path);
      target = target[s];
    }
    target.push(S.newItemFor(f, ptr));
    const n = target.length - 1;
    const plain = instantiate(tpl, token, n);
    const filled = fill(instantiate(tpl, token, n), withNew);
    if (canon(plain) !== canon(filled)) problems.push(`${p}: template doesn't match newItem\n  tmpl: ${canon(plain).slice(0, 3000)}\n  new:  ${canon(filled).slice(0, 3000)}`);
  }
  return { problems, counts };
}

const pages = ['/', '/experience/', '/contact/', '/blog/'];
const browser = await chromium.launch();
let failed = 0;
try {
  for (const vp of [{ viewport: { width: 1440, height: 900 } }, devices['iPhone 13']]) {
    const ctx = await browser.newContext(vp);
    for (const p of pages) {
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(base + p, { waitUntil: 'load' });
      await page.addScriptTag({ content: bundle });
      const { problems, counts } = await page.evaluate(check, { raw });
      // layout sanity: nothing wider than the viewport
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 0) problems.push(`horizontal overflow ${overflow}px`);
      problems.push(...errors.map((e) => `page error: ${e}`));
      const tag = `${p} @${vp.viewport.width}`;
      if (problems.length) { failed++; console.error(`FAIL ${tag}\n  ` + problems.join('\n  ')); }
      else console.log(`ok   ${tag}  lists=${counts.lists} items=${counts.items} templates=${counts.templates} pointers=${counts.pointers}`);
      await page.close();
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
assert.equal(failed, 0, `${failed} page(s) failed`);
