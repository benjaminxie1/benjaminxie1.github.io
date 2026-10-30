// "Review changes": what will be published, per file: blocking problems first (each with
// Show), then added / removed / moved items and field changes (word diff for text, old → new
// thumbnails for images). Every row can be undone on its own; a whole file can be discarded.
import { h } from '../ui/dom';
import { openDialog, type DialogCtl } from '../ui/dialog';
import { split, type Key } from './pointer';
import type { Change } from './state';
import { fileLabel, crumbs, summary, itemLabel, type Field } from './fields';

type Tok = { t: string; d: 0 | 1 }; // d: 1 = removed (old side) / added (new side)
const splitWords = (s: string) => s.match(/\s+|[\p{L}\p{N}_'’]+|[^\s\p{L}\p{N}_]/gu) || [];
/** Word diff (LCS over tokens). Long texts fall back to "all changed". */
export function diff(a: string, b: string): { old: Tok[]; now: Tok[] } {
  const x = splitWords(a), y = splitWords(b);
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
  const merge = (ts: Tok[]) => ts.reduce<Tok[]>((acc, t, k) => {
    const prev = acc[acc.length - 1];
    const glue = t.d === 0 && /^\s+$/.test(t.t) && prev?.d === 1 && ts[k + 1]?.d === 1;
    const tok = glue ? { t: t.t, d: 1 as const } : t;
    if (prev && prev.d === tok.d) prev.t += tok.t; else acc.push({ ...tok });
    return acc;
  }, []);
  return { old: merge(old), now: merge(now) };
}

export type ReviewHost = {
  changes(): Change[];
  issues(): { file: string; key: Key; message: string }[];
  data(file: string): unknown;
  imgSrc(path: string): string;
  revert(c: Change): void;
  discardFile(file: string): void;
  show(k: Key): void;
  discardAll(): Promise<boolean>;
  publish(ctl: DialogCtl): Promise<boolean>;
  connected(): boolean;
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const ORDER = { added: 0, removed: 1, moved: 2, field: 3 } as const;

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
  const btn = (text: string, run: () => void, cls = '') => h('button', { type: 'button', class: `linkish rv-act ${cls}`, text, on: { click: run } });
  const showB = (k: Key) => btn('Show', () => { ctl.close('show'); setTimeout(() => host.show(k), 0); });
  const undoB = (c: Change, text: string) => btn(text, () => { host.revert(c); paint(); });

  function valueView(f: Field | null, v: unknown, cls: string, mark: 'del' | 'ins', toks?: Tok[]): HTMLElement {
    const p = h('div', { class: `rv-v ${cls}` });
    if (v === undefined && f?.type === 'boolean') { p.append('Off'); return p; }
    if (v === undefined) { p.append(h('i', { class: 'rv-none', text: f && (f.type === 'object' || f.type === 'image' || f.optional) ? '(not shown)' : '(none)' })); return p; }
    if (f?.type === 'image' && typeof v === 'string') { p.append(v ? h('span', { class: 'rv-thumb' }, h('img', { src: host.imgSrc(v), alt: '' })) : h('i', { class: 'rv-none', text: '(no image)' }), h('span', { class: 'rv-path', text: ` ${v.split('/').pop()}` })); return p; }
    if (typeof v === 'boolean') { p.append(v ? 'On' : 'Off'); return p; }
    if (typeof v === 'number') { p.append(String(v)); return p; }
    if (f?.type === 'select' && typeof v === 'string') { p.append(f.options.find((o) => o.value === v)?.label ?? v); return p; }
    if (typeof v === 'string') {
      if (toks) p.append(...(toks.length ? toks.map((t) => (t.d ? h(mark, { text: t.t }) : t.t)) : [h('i', { class: 'rv-none', text: '(empty)' })]));
      else p.append(v || h('i', { class: 'rv-none', text: '(empty)' }));
      return p;
    }
    p.append(h('i', { class: 'rv-none', text: 'Shown' }));
    return p;
  }

  function row(c: Change): HTMLElement {
    const data = host.data(c.file);
    const top = h('div', { class: 'rv-top' });
    const li = h('li', { class: `rv-row rv-${c.kind}` }, top);
    if (c.kind === 'field') {
      const path = crumbs(c.file, c.ptr, data);
      const label = path[path.length - 1] || 'Text';
      top.append(h('span', { class: 'rv-label', text: c.old === undefined ? `${label} · added` : c.now === undefined ? `${label} · removed` : label }), h('span', { class: 'rv-key', text: path.slice(0, -1).join(' › ') }), h('span', { class: 'rv-gap' }), h('span', { class: 'rv-btns' }, showB(c.key), undoB(c, 'Revert')));
      const d = typeof c.old === 'string' && typeof c.now === 'string' && c.field?.type !== 'image' ? diff(c.old, c.now) : null;
      li.append(valueView(c.field, c.old, 'rv-old', 'del', d?.old), valueView(c.field, c.now, 'rv-new', 'ins', d?.now));
      return li;
    }
    const L = c.listPtr;
    const what = itemLabel(c.file, L);
    const where = crumbs(c.file, L, data).join(' › ');
    if (c.kind === 'added') {
      top.append(h('span', { class: 'rv-badge rv-b-add', text: 'Added' }), h('span', { class: 'rv-label', text: `${cap(what)} · ${summary(c.file, L, c.index, c.value)}` }), h('span', { class: 'rv-key', text: where }), h('span', { class: 'rv-gap' }), h('span', { class: 'rv-btns' }, showB(c.key), undoB(c, 'Remove')));
    } else if (c.kind === 'removed') {
      top.append(h('span', { class: 'rv-badge rv-b-del', text: 'Removed' }), h('span', { class: 'rv-label', text: `${cap(what)} · ${summary(c.file, L, c.baseIndex, c.value)}` }), h('span', { class: 'rv-key', text: where }), h('span', { class: 'rv-gap' }), h('span', { class: 'rv-btns' }, undoB(c, 'Restore')));
    } else {
      top.append(h('span', { class: 'rv-badge rv-b-move', text: 'Moved' }), h('span', { class: 'rv-label', text: `${cap(what)} · ${summary(c.file, L, c.index, c.value)}` }), h('span', { class: 'rv-key', text: `${where} · was ${c.from + 1}, now ${c.index + 1}` }), h('span', { class: 'rv-gap' }), h('span', { class: 'rv-btns' }, showB(c.key), undoB(c, 'Move back')));
    }
    return li;
  }

  function paint() {
    const cs = host.changes();
    const issues = host.issues();
    const n = cs.length;
    ctl.buttons.publish.disabled = !n || issues.length > 0;
    ctl.buttons.publish.textContent = !host.connected() ? 'Connect GitHub to publish' : issues.length ? 'Fix the problems to publish' : n ? `Publish ${n} ${n === 1 ? 'change' : 'changes'}` : 'Publish changes';
    ctl.buttons.discard.disabled = !n;
    list.replaceChildren();
    if (issues.length) {
      const ul = h('ul', { class: 'rv-issues' });
      for (const i of issues) {
        const path = crumbs(i.file, split(i.key.slice(i.key.indexOf(':') + 1))?.parent ?? '', host.data(i.file));
        ul.append(h('li', {}, h('span', { class: 'rv-ibody' }, h('b', { text: i.message }), path.length ? h('span', { class: 'rv-key', text: ` ${fileLabel(i.file)} › ${path.join(' › ')}` }) : null), showB(i.key)));
      }
      list.append(h('div', { class: 'rv-block', role: 'alert' }, h('p', { class: 'rv-blockhead', text: issues.length === 1 ? 'Fix this before publishing:' : `Fix these ${issues.length} things before publishing:` }), ul));
    }
    if (!n) { list.append(h('p', { class: 'rv-empty', text: 'No changes yet. Click any text on the page to edit it, or use Details for everything else.' })); return; }
    const byFile = new Map<string, Change[]>();
    for (const c of cs) (byFile.get(c.file) || byFile.set(c.file, []).get(c.file)!).push(c);
    for (const [file, rows] of byFile) {
      const disc = btn('Discard these', () => { host.discardFile(file); paint(); }, 'rv-discard');
      list.append(h('h3', { class: 'rv-file' }, fileLabel(file), h('span', { class: 'rv-path', text: ` · ${file}.json` }), h('span', { class: 'rv-gap' }), disc));
      const ul = h('ul', { class: 'rv-rows' });
      rows.sort((a, b) => ORDER[a.kind] - ORDER[b.kind]).forEach((c) => ul.append(row(c)));
      list.append(ul);
    }
  }
  paint();
  return { ctl, result, paint };
}
