// "Review changes": every changed field, old → new with a word-level diff, grouped by
// file. Each row can be reverted or shown on the page; the dialog's primary action publishes.
import { h } from '../ui/dom';
import { openDialog, type DialogCtl } from '../ui/dialog';
import { prettyKey, type Key } from './pointer';
import type { Change } from './state';

type Tok = { t: string; d: 0 | 1 }; // d: 1 = removed (old side) / added (new side)
const split = (s: string) => s.match(/\s+|[\p{L}\p{N}_'’]+|[^\s\p{L}\p{N}_]/gu) || [];
/** Word diff (LCS over tokens). Long texts fall back to "all changed". */
export function diff(a: string, b: string): { old: Tok[]; now: Tok[] } {
  const x = split(a), y = split(b);
  if (x.length * y.length > 250000) return { old: [{ t: a, d: 1 }], now: [{ t: b, d: 1 }] };
  const n = x.length, m = y.length;
  const L: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const old: Tok[] = [], now: Tok[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { old.push({ t: x[i], d: 0 }); now.push({ t: y[j], d: 0 }); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) old.push({ t: x[i++], d: 1 });
    else now.push({ t: y[j++], d: 1 });
  }
  while (i < n) old.push({ t: x[i++], d: 1 });
  while (j < m) now.push({ t: y[j++], d: 1 });
  // whitespace-only differences between changed words read as one change
  const merge = (ts: Tok[]) => ts.reduce<Tok[]>((acc, t, k) => {
    const prev = acc[acc.length - 1];
    const glue = t.d === 0 && /^\s+$/.test(t.t) && prev?.d === 1 && ts[k + 1]?.d === 1;
    const tok = glue ? { t: t.t, d: 1 as const } : t;
    if (prev && prev.d === tok.d) prev.t += tok.t; else acc.push({ ...tok });
    return acc;
  }, []);
  return { old: merge(old), now: merge(now) };
}

const FILE_LABEL: Record<string, string> = { home: 'Home', experience: 'Experience', contact: 'Contact', site: 'Shared across the site' };
const TAG_LABEL: Record<string, string> = { h1: 'Heading', h2: 'Heading', h3: 'Heading', h4: 'Heading', p: 'Paragraph', li: 'List item', a: 'Link text', title: 'Page title', time: 'Date', span: 'Text', div: 'Text', strong: 'Text', em: 'Text', dt: 'Label', dd: 'Text', small: 'Text', meta: 'Description' };

export type ReviewHost = {
  changes(): Change[];
  info(k: Key): { kind: 'plain' | 'inline' | 'href'; tag: string } | undefined;
  revert(k: Key): void;
  show(k: Key): void;
  discardAll(): Promise<boolean>;
  publish(ctl: DialogCtl): Promise<boolean>;
  connected(): boolean;
};

export function openReview(host: ReviewHost) {
  const list = h('div', { class: 'rv-list' });
  const { ctl, result } = openDialog({
    title: 'Review changes',
    size: 'lg',
    className: 'review-dlg',
    body: list,
    actions: [
      { label: 'Discard all…', value: 'discard', kind: 'quiet', run: async () => { const ok = await host.discardAll(); if (!ok) return false; } },
      { label: 'Keep editing', value: 'close', kind: 'ghost' },
      { label: 'Publish changes', value: 'publish', kind: 'primary', busyLabel: 'Publishing…', run: (c) => host.publish(c).then((ok) => (ok ? undefined : false)) },
    ],
    focus: '.btn-primary',
  });
  function paint() {
    const cs = host.changes();
    const n = cs.length;
    ctl.buttons.publish.disabled = !n;
    ctl.buttons.publish.textContent = !host.connected() ? 'Connect GitHub to publish' : n ? `Publish ${n} ${n === 1 ? 'change' : 'changes'}` : 'Publish changes';
    ctl.buttons.discard.disabled = !n;
    list.replaceChildren();
    if (!n) { list.append(h('p', { class: 'rv-empty', text: 'No changes yet. Click any text on the page to edit it.' })); return; }
    const byFile = new Map<string, Change[]>();
    for (const c of cs) (byFile.get(c.file) || byFile.set(c.file, []).get(c.file)!).push(c);
    for (const [file, rows] of byFile) {
      list.append(h('h3', { class: 'rv-file' }, FILE_LABEL[file] || file, h('span', { class: 'rv-path', text: ` · ${file}.json` })));
      const ul = h('ul', { class: 'rv-rows' });
      for (const c of rows) {
        const inf = host.info(c.key);
        const label = !inf ? 'Text' : inf.kind === 'href' ? 'Link address' : TAG_LABEL[inf.tag] || 'Text';
        const d = diff(c.old, c.now);
        const side = (ts: Tok[], cls: string, mark: 'del' | 'ins') => h('p', { class: `rv-v ${cls}` }, ...(ts.length ? ts.map((t) => (t.d ? h(mark, { text: t.t }) : t.t)) : [h('i', { class: 'rv-none', text: '(empty)' })]));
        ul.append(h('li', { class: 'rv-row' },
          h('div', { class: 'rv-top' },
            h('span', { class: 'rv-label', text: label }),
            h('span', { class: 'rv-key', text: prettyKey(c.key).replace(/^[^›]+› /, '') }),
            h('span', { class: 'rv-gap' }),
            h('button', { type: 'button', class: 'linkish rv-act', text: 'Show', on: { click: () => { ctl.close('show'); setTimeout(() => host.show(c.key), 0); } } }),
            h('button', { type: 'button', class: 'linkish rv-act', text: 'Revert', on: { click: () => { host.revert(c.key); paint(); } } }),
          ),
          side(d.old, 'rv-old', 'del'),
          side(d.now, 'rv-new', 'ins'),
        ));
      }
      list.append(ul);
    }
  }
  paint();
  return { ctl, result, paint };
}
