// Tests for src/content/site/schema.ts (validateFile / coerceFile / helpers).
//   node tests/schema.test.mjs
// Bundles the schema with esbuild (npx esbuild must work) into a temp file and imports it.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'schema-test-'));
const out = join(dir, 'schema.mjs');
execFileSync('npx', ['esbuild', '--bundle', '--platform=node', '--format=esm', '--log-level=warning', `--outfile=${out}`, join(root, 'src/content/site/schema.ts')], { cwd: root, stdio: 'inherit' });
const S = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true, force: true });
const { siteSchema, validateFile, coerceFile, resolveSiteLink, fieldAt, newItemFor, defaultAt, iconPath, linkIcons, hrefOf } = S;

let passed = 0;
const t = (name, fn) => {
  try { fn(); passed++; } catch (e) { console.error(`FAIL ${name}\n`, e.message); process.exitCode = 1; }
};
const json = (f) => JSON.parse(readFileSync(join(root, 'src/content/site', f + '.json'), 'utf8'));
const FILES = ['site', 'home', 'experience', 'contact'];
const clone = (x) => JSON.parse(JSON.stringify(x));

// ---------- real data ----------
for (const f of FILES) {
  t(`${f}: real data validates`, () => assert.deepEqual(validateFile(f, json(f)), []));
  t(`${f}: coerce is identity on real data (same keys, same order)`, () => {
    const d = json(f);
    assert.equal(JSON.stringify(coerceFile(f, d)), JSON.stringify(d));
  });
  t(`${f}: coerce does not mutate input`, () => {
    const d = json(f); const before = JSON.stringify(d);
    coerceFile(f, { ...d, junk: 1 }); assert.equal(JSON.stringify(d), before);
  });
}

// every key in the JSON files is covered by the schema
const keysCovered = (fields, v, path) => {
  for (const [k, x] of Object.entries(v)) {
    const f = fields[k];
    assert.ok(f, `no schema for ${path}/${k}`);
    if (f.type === 'object') keysCovered(f.fields, x, `${path}/${k}`);
    if (f.type === 'list' && f.item.type === 'object') x.forEach((it, i) => keysCovered(f.item.fields, it, `${path}/${k}/${i}`));
  }
};
for (const f of FILES) t(`${f}: schema covers every key`, () => keysCovered(siteSchema[f].fields, json(f), ''));

// newItems are valid list items, and newItem defaults validate when inserted
const lists = [
  ['site', '/nav'], ['home', '/paragraphs'], ['home', '/links'], ['contact', '/links'],
  ['experience', '/jobs'], ['experience', '/projects'], ['experience', '/projects/0/links'], ['experience', '/projects/1/mock/rows'],
];
for (const [f, p] of lists) {
  t(`${f}:${p} newItem is coerce-stable`, () => {
    const d = json(f);
    const segs = p.split('/').slice(1);
    let arr = d; for (const s of segs) arr = arr[s];
    const item = newItemFor(f, p);
    assert.ok(item !== undefined);
    arr.push(item);
    assert.equal(JSON.stringify(coerceFile(f, d)), JSON.stringify(d));
    // a fresh item is flagged only for what Ben must still fill in: URLs and placeholder text/images
    for (const e of validateFile(f, d)) assert.match(e.message, /URL|placeholder/, `${e.path}: ${e.message}`);
  });
}
t('new job/project/link are flagged until their URLs are filled in', () => {
  const d = json('experience');
  d.jobs.push(newItemFor('experience', '/jobs'));
  const errs = validateFile('experience', d);
  const paths = errs.map((e) => e.path);
  assert.ok(paths.includes('/jobs/3/href'));
  // placeholder text and the placeholder logo are flagged too, so nothing half-filled can go live
  for (const k of ['role', 'org', 'place', 'logo']) assert.ok(paths.includes(`/jobs/3/${k}`), k);
  assert.ok(errs.every((e) => e.path.startsWith('/jobs/3/')));
});
t('new project placeholder images exist', () => {
  for (const p of ['/site/placeholder-logo.svg', '/site/placeholder-project.svg']) readFileSync(join(root, 'public', p));
  assert.equal(newItemFor('experience', '/jobs').logo, '/site/placeholder-logo.svg');
});
t('newItemFor returns a fresh copy', () => {
  const a = newItemFor('experience', '/projects'); a.links.push(1);
  assert.equal(newItemFor('experience', '/projects').links.length, 1);
});

// ---------- coerce ----------
t('coerce never throws on garbage', () => {
  for (const f of [...FILES, 'nope']) for (const v of [null, undefined, 1, 'x', [], [1], { jobs: 'x' }, { projects: [null, 1, 'a', { links: 'x' }] }, { nav: [{}, null] }])
    coerceFile(f, v);
});
t('coerce unknown file returns data unchanged', () => { const o = { a: 1 }; assert.equal(coerceFile('nope', o), o); });
t('coerce fills required, drops junk, keeps optionals absent', () => {
  const c = coerceFile('experience', { jobs: [{ role: 'R', extra: 1 }, null, 'junk'], projects: [{ project: 'P', links: [{ icon: 'nope', href: 'https://a.b' }] }] });
  assert.equal(c.heading, '');
  assert.deepEqual(Object.keys(c), ['heading', 'jobs', 'projectsHeading', 'projects']);
  assert.equal(c.jobs.length, 1);
  assert.deepEqual(c.jobs[0], { role: 'R', org: '', href: '', dates: '' });
  const p = c.projects[0];
  assert.equal(p.sponsor, undefined); assert.equal(p.image, undefined); assert.equal(p.mock, undefined);
  assert.deepEqual(p.links, [{ label: '', icon: 'link', href: 'https://a.b' }]);
});
t('coerce numbers/booleans/strings', () => {
  const c = coerceFile('experience', { projects: [{ sponsor: { src: '/a.svg', alt: 'A', h: '30', dark: 'true' }, date: 2026 }, { sponsor: { src: '/a.svg', alt: 'A', h: 999 } }, { sponsor: { src: '/a.svg', alt: 'A', h: 'x' } }] });
  assert.equal(c.projects[0].sponsor.h, 30);
  assert.equal(c.projects[0].sponsor.dark, true);
  assert.equal(c.projects[0].date, '2026');
  assert.equal(c.projects[1].sponsor.h, 48);
  assert.equal(c.projects[2].sponsor.h, 24);
});
t('coerce: empty optional image means no image', () => {
  const c = coerceFile('experience', { jobs: [{ role: 'R', logo: '' }], projects: [{ image: '' }] });
  assert.equal('logo' in c.jobs[0], false); assert.equal('image' in c.projects[0], false);
});
t('coerce: select falls back / drops', () => {
  const c = coerceFile('site', { nav: [{ href: '/nowhere', label: 'X' }] });
  assert.equal(c.nav[0].href, '/');
  const h = coerceFile('home', { links: [{ label: 'A', site: 'myspace' }, { label: 'B', site: 'github', href: '' }] });
  assert.deepEqual(h.links, [{ label: 'A' }, { label: 'B', site: 'github' }]);
});
t('coerce: list max truncates', () => {
  const c = coerceFile('experience', { projects: [{ links: Array.from({ length: 9 }, () => ({ label: 'x', icon: 'pdf', href: '/a' })) }] });
  assert.equal(c.projects[0].links.length, 4);
});

// ---------- validate ----------
t('validate never throws', () => {
  for (const f of [...FILES, 'nope']) for (const v of [null, 1, 'x', [], { jobs: 'x' }, { projects: [null] }]) assert.ok(Array.isArray(validateFile(f, v)));
});
t('validate pointers + messages', () => {
  const d = json('experience');
  d.jobs[1].href = 'javascript:alert(1)';
  d.jobs[0].role = '  ';
  d.projects[0].sponsor.h = 4;
  d.projects[1].links[0].icon = 'nope';
  d.projects[2].links[0].href = 'http://localhost';
  delete d.projects[3].pitch;
  const errs = validateFile('experience', d);
  assert.deepEqual(errs.map((e) => e.path).sort(), ['/jobs/0/role', '/jobs/1/href', '/projects/0/sponsor/h', '/projects/1/links/0/icon', '/projects/2/links/0/href', '/projects/3/pitch'].sort());
  for (const e of errs) assert.ok(e.message.length > 5);
});
t('validate site: email, absolute URLs, nav min', () => {
  const d = json('site');
  d.email = 'not an email'; d.github = '/relative'; d.nav = [];
  assert.deepEqual(validateFile('site', d).map((e) => e.path), ['/email', '/github', '/nav']);
});
t('validate home links: need a site or a custom URL', () => {
  const d = json('home');
  d.links.push({ label: 'Blog', href: '/blog' }, { label: 'Nothing' }, { label: 'Bad', href: 'ftp://x' });
  assert.deepEqual(validateFile('home', d).map((e) => e.path), ['/links/6/href', '/links/5/href']);
});
t('validate list max', () => {
  const d = json('home'); d.paragraphs = Array(13).fill('x');
  assert.deepEqual(validateFile('home', d).map((e) => e.path), ['/paragraphs']);
});
t('validate unknown file / non-object', () => {
  assert.equal(validateFile('nope', {}).length, 1);
  assert.equal(validateFile('home', []).length, 1);
});

// ---------- helpers ----------
t('fieldAt', () => {
  assert.equal(fieldAt('experience', '/projects/3/links/0/icon').type, 'select');
  assert.equal(fieldAt('experience', '/projects/__i__/mock/rows/__j__/pill').type, 'boolean');
  assert.equal(fieldAt('experience', '/projects/x/links'), null);
  assert.equal(fieldAt('experience', '/nope'), null);
});
t('defaultAt', () => {
  assert.equal(defaultAt('experience', '/jobs/0/span'), '3 mo');
  assert.deepEqual(defaultAt('experience', '/projects/0/sponsor'), { src: '/site/placeholder-logo.svg', alt: 'Sponsor', h: 24 });
  assert.equal(defaultAt('experience', '/projects/0/mock').rows.length, 1);
});
t('resolveSiteLink', () => {
  const site = json('site');
  assert.deepEqual(resolveSiteLink({ label: 'G', site: 'github' }, site, 'home:/links/0'), { href: site.github, editHref: 'site:/github' });
  assert.deepEqual(resolveSiteLink({ label: 'E', site: 'email' }, site, 'home:/links/3'), { href: `mailto:${site.email}` });
  assert.deepEqual(resolveSiteLink({ label: 'C', site: 'github', href: 'https://c.d' }, site, 'home:/links/1'), { href: 'https://c.d', editHref: 'home:/links/1/href' });
  assert.deepEqual(resolveSiteLink({ label: 'N', href: 'https://' }, site, 'home:/links/__i__'), { href: '#', editHref: 'home:/links/__i__/href' });
});
t('icons + hrefOf', () => {
  for (const k of ['github', 'youtube', 'pdf', 'globe', 'link']) assert.ok(linkIcons[k].path.startsWith('M'));
  assert.equal(iconPath('nope'), linkIcons.link.path);
  assert.equal(hrefOf('javascript:x'), '#'); assert.equal(hrefOf('/a'), '/a'); assert.equal(hrefOf(undefined), '#');
});

console.log(`${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
