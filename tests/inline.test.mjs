// Tests for src/lib/inline.ts (renderInline / inlineFromNode).
//   node tests/inline.test.mjs
// Needs Node >= 22.18 (runs the .ts file directly) and, for the DOM round-trip part,
// Playwright's chromium: `require('playwright')` must resolve (e.g. NODE_PATH=<global node_modules>).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import * as inl from '../src/lib/inline.ts';

const { renderInline, parseInline, normalizeInline, serializeInline } = inl;
let passed = 0;
const t = (name, fn) => {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error(`FAIL ${name}\n`, e.message);
    process.exitCode = 1;
  }
};

// ---------- rendering & safety ----------
const R = [
  ['plain', 'Hi, I\'m Ben.', 'Hi, I&#39;m Ben.'.replace('&#39;', "'")],
  ['html is escaped', '<script>alert(1)</script> & "q"', '&lt;script&gt;alert(1)&lt;/script&gt; &amp; "q"'],
  ['bold/italic', '**b** and *i*', '<strong>b</strong> and <em>i</em>'],
  ['link', '[UC Berkeley](https://www.berkeley.edu)', '<a href="https://www.berkeley.edu">UC Berkeley</a>'],
  ['attr escaping', '[x](https://a.com/?q="><img/src=x>&a=\'1\')', '<a href="https://a.com/?q=&quot;&gt;&lt;img/src=x&gt;&amp;a=&#39;1&#39;">x</a>'],
  ['url with space dropped', '[x](https://a.com/a b)', 'x'],
  ['parens in url', '[Foo](https://en.wikipedia.org/wiki/Foo_(bar))', '<a href="https://en.wikipedia.org/wiki/Foo_(bar)">Foo</a>'],
  ['site-relative', '[post](/blog/x)', '<a href="/blog/x">post</a>'],
  ['mailto', '[mail](mailto:benx@berkeley.edu)', '<a href="mailto:benx@berkeley.edu">mail</a>'],
  ['javascript: dropped', '[evil](javascript:alert(1))', 'evil'],
  ['JaVaScRiPt: dropped', '[evil](JaVaScRiPt:alert(1))', 'evil'],
  ['data: dropped', '[evil](data:text/html,hi)', 'evil'],
  ['protocol-relative dropped', '[evil](//evil.com)', 'evil'],
  ['backslash host dropped', '[evil](/\\evil.com)', 'evil'],
  ['control char dropped', '[evil](https://a.com/\u0000)', 'evil'],
  ['lone stars', '5 * 3 = 15, a*b', '5 * 3 = 15, a*b'],
  ['flanking', '2 * 3 * 4', '2 * 3 * 4'],
  ['unclosed', '**not closed and *also', '**not closed and *also'],
  ['brackets', '[brackets] and (parens)', '[brackets] and (parens)'],
  ['escapes', '\\*not italic\\* \\[x\\](y)', '*not italic* [x](y)'],
  ['other backslashes literal', 'C:\\Users\\ben', 'C:\\Users\\ben'],
  ['nested', '**bold [link](/a)** [*it*](/b)', '<strong>bold <a href="/a">link</a></strong> <a href="/b"><em>it</em></a>'],
  ['triple', '***both***', '<strong><em>both</em></strong>'],
  ['no nested links', '[a [b](/c) d](/e)', '<a href="/c">a [b</a> d](/e)'],
];
for (const [name, md, html] of R) t(`render: ${name}`, () => assert.equal(renderInline(md), html));
t('render: pathological input is fast', () => {
  const s = '*'.repeat(400) + '[a'.repeat(200) + '**x*'.repeat(200);
  const t0 = Date.now();
  renderInline(s);
  assert.ok(Date.now() - t0 < 2000);
});

// ---------- round-trips (markdown → tree → markdown) ----------
const ROUND = [
  'Hi, I\'m Ben.',
  'He said "hi" & \'bye\' <b>not bold</b> x < y && y > z',
  'I\'m a student studying Electrical Engineering & Computer Sciences (EECS) and Business @ [UC Berkeley](https://www.berkeley.edu) in the [M.E.T. program](https://met.berkeley.edu).',
  '5 * 3 = 15, a*b, 2 * 3 * 4',
  '[brackets] and (parens) and [x] (y)',
  'see [Foo (bar)](https://en.wikipedia.org/wiki/Foo_(bar)) now',
  '[unbalanced](https://x.com/a\\(b)',
  '**bold [link](https://x.com/a?b=1&c=2)** and *it*',
  '[**bold** in link](/blog/x) and [*it*](mailto:benx@berkeley.edu)',
  '***both*** and *a **b** c* and **a *b* c**',
  '*a***b** and **a***b*',
  'Unicode: café — naïve 日本語 🚀 – “curly” ‘single’ … ½',
  'Digital twin world models for the wet lab. Test your experiment virtually before you run it.',
  'C:\\Users\\ben and a \\ b',
  '\\*\\*not bold\\** but *x*',
  'Use *literally\\* stars',
  '[a\\](b) is not a link',
  'price: $7.5k [prize] — 1st *Place*',
  'trailing backslash \\',
  '[link](https://a.com/x\\\\)',
];
for (const md of ROUND)
  t(`round-trip: ${md}`, () => assert.equal(serializeInline(normalizeInline(parseInline(md))), md));

// semantic round-trip for anything (even non-canonical input): same tree after a trip
const SEMANTIC = ['\\*literally\\* stars', '** a **', '[ ](https://a.com)', '*a *b**', '[](x) []()', '[evil](javascript:x) ok'];
for (const md of SEMANTIC)
  t(`semantic: ${md}`, () => {
    const tree = normalizeInline(parseInline(md));
    assert.deepEqual(normalizeInline(parseInline(serializeInline(tree))), tree);
  });

// ---------- fuzz: random trees serialize to markdown that parses back to them ----------
let seed = 12345;
const rnd = (n) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed % n);
const ALPH = ['a', 'b', ' ', '*', '**', '[', ']', '(', ')', '\\', '&', '<', '"', '—', 'é', '🚀', 'x y'];
const URLS = ['https://a.com', '/p', 'https://a.com/x_(y)', 'https://a.com/(', 'mailto:a@b.c', 'https://a.com/\\', '/a)b'];
function randTree(depth, inLink) {
  const out = [];
  const k = 1 + rnd(4);
  for (let i = 0; i < k; i++) {
    const r = depth > 0 ? rnd(6) : 0;
    if (r < 3) out.push({ t: 'text', v: Array.from({ length: 1 + rnd(4) }, () => ALPH[rnd(ALPH.length)]).join('') });
    else if (r === 3) out.push({ t: 'strong', c: randTree(depth - 1, inLink) });
    else if (r === 4) out.push({ t: 'em', c: randTree(depth - 1, inLink) });
    else if (!inLink) out.push({ t: 'link', href: URLS[rnd(URLS.length)], c: randTree(depth - 1, true) });
  }
  return out;
}
let fuzzFail = 0;
for (let n = 0; n < 3000; n++) {
  const tree = normalizeInline(randTree(3, false));
  const md = serializeInline(tree);
  const back = normalizeInline(parseInline(md));
  try {
    assert.deepEqual(back, tree);
    assert.equal(serializeInline(back), md); // stable
  } catch {
    if (fuzzFail++ < 3) console.error('FUZZ FAIL', JSON.stringify(tree), JSON.stringify(md));
  }
}
t('fuzz: 3000 random trees round-trip', () => assert.equal(fuzzFail, 0));
// random strings: whatever they parse to survives a trip
let strFail = 0;
for (let n = 0; n < 3000; n++) {
  const s = Array.from({ length: 1 + rnd(14) }, () => ALPH[rnd(ALPH.length)] + (rnd(5) ? '' : '](/u)')).join('');
  const tree = normalizeInline(parseInline(s));
  const md = serializeInline(tree);
  if (JSON.stringify(normalizeInline(parseInline(md))) !== JSON.stringify(tree) && strFail++ < 3)
    console.error('STR FAIL', JSON.stringify(s), JSON.stringify(md));
}
t('fuzz: 3000 random strings survive a trip', () => assert.equal(strFail, 0));

// ---------- DOM: inlineFromNode in a real browser ----------
let chromium;
try {
  ({ chromium } = createRequire(import.meta.url)('playwright'));
} catch {
  console.warn('playwright not found: skipping DOM tests (set NODE_PATH to a node_modules that has it)');
}
if (chromium) {
  const src = stripTypeScriptTypes(readFileSync(new URL('../src/lib/inline.ts', import.meta.url), 'utf8')).replace(/^export /gm, '');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent('<p id="el"></p>');
  await page.addScriptTag({ content: src + '\nwindow.__inl = { renderInline, inlineFromNode };' });
  const dom = await page.evaluate((cases) => {
    const el = document.getElementById('el');
    return cases.map((x) => {
      el.innerHTML = window.__inl.renderInline(x);
      return window.__inl.inlineFromNode(el);
    });
  }, ROUND);
  ROUND.forEach((x, k) => t(`DOM round-trip: ${x}`, () => assert.equal(dom[k], x)));
  // what contenteditable typically produces
  const EDITED = [
    ['<b>a</b><i> b</i><br>c<span>d</span>', '**a** *b* cd'],
    ['<em><strong>x</strong></em>', '***x***'],
    ['<b>a<b>b</b></b> <i>c<i>d</i></i>', '**ab** *cd*'],
    ['line\none', 'line one'],
    ['<a href="/x">a<a href="/y">b</a></a>', '[a](/x)[b](/y)'],
    ['<a href="javascript:alert(1)">evil</a>', 'evil'],
    ['type *stars* and [x](y)', 'type *stars\\* and [x\\](y)'],
    ['<b> spaced </b>', ' **spaced** '],
    ['<a href="https://a.com/?a=1&amp;b=&quot;2&quot;">q</a>', '[q](https://a.com/?a=1&b="2")'],
    ['<b></b><a href="/x"></a>end', 'end'],
  ];
  const got = await page.evaluate((cases) => {
    const el = document.getElementById('el');
    return cases.map(([h]) => {
      el.innerHTML = h;
      const md = window.__inl.inlineFromNode(el);
      const text = el.textContent.replace(/\n/g, ' ');
      el.innerHTML = window.__inl.renderInline(md);
      return [md, text, el.textContent];
    });
  }, EDITED);
  EDITED.forEach(([h, want], k) =>
    t(`DOM from edited: ${h}`, () => {
      assert.equal(got[k][0], want);
      if (!/javascript|<br>/.test(h)) assert.equal(got[k][2], got[k][1], 'visible text preserved');
    }),
  );
  await browser.close();
}

console.log(`${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
