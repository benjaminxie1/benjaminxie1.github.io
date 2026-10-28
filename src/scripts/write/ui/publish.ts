// Publish sheet: slug, date, summary, cover, link-preview card, and a button
// that names exactly what will happen. Also the standalone cover dialog.
import { isSlugTaken, uploadImage } from '../github';
import { slugify, today } from '../lib';
import { h } from './dom';
import { pickFile } from './dom';
import { openDialog } from './dialog';
import { prettyUrl, SITE_HOST } from './format';
import { toast } from './toast';

export type SheetHost = {
  title(): string;
  summary(): string;
  date(): string;
  slug(): string;
  /** slug is fixed once the post has been published */
  slugLocked(): boolean;
  /** slug of the repo file this post already has (a draft), if any */
  ownSlug(): string | null;
  published(): boolean;
  hasCover(): boolean;
  coverUrl(): string | null; // displayable now
  setSlug(s: string): void;
  setDate(d: string): void;
  setSummary(s: string): void;
  setCover(src: string, preview: string | null): void;
  removeCover(): void;
  publish(): Promise<{ ok: true } | { ok: false; message?: string; handled?: boolean }>;
  /** Other frontmatter (doc.extra): `tags`, `updated`. Optional so the sheet still works without them. */
  meta?(key: string): unknown;
  setMeta?(key: string, value: unknown): void;
};

// ---------- tags ----------
const MAX_TAGS = 8;
/** Tag as written, tidied: trimmed, single spaces, no commas/brackets, ≤ 32 chars. */
export const cleanTag = (t: string) => t.replace(/[,\[\]{}#"]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 32).trim();
const tagKey = (t: string) => slugify(t, '') || t.trim().toLowerCase();
export function readTags(v: unknown): string[] {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [];
  const seen = new Set<string>();
  return list.map((t) => cleanTag(String(t ?? ''))).filter((t) => t && !seen.has(tagKey(t)) && seen.add(tagKey(t)));
}
type KnownTag = { name: string; count: number };
let knownTags: Promise<KnownTag[]> | null = null;
/** Tags used by live posts (built by the site at /blog/tags.json). Empty if unavailable. */
const loadKnownTags = () =>
  (knownTags ??= fetch('/blog/tags.json', { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : []))
    .then((a) => (Array.isArray(a) ? a.filter((t) => t && typeof t.name === 'string') : []))
    .catch(() => []));

function tagField(host: SheetHost & Required<Pick<SheetHost, 'meta' | 'setMeta'>>) {
  let tags = readTags(host.meta('tags'));
  let known: KnownTag[] = [];
  let hot: string | null = null;
  const chips = h('span', { class: 'tag-chips' });
  const box = h('div', { class: 'tag-box' }, chips);
  const input = h('input', { class: 'tag-in', id: 'pub-tags', autocomplete: 'off', spellcheck: 'false', 'aria-describedby': 'pub-tags-msg' });
  const sugg = h('div', { class: 'tag-sugg', 'aria-label': 'Suggested tags' });
  const msg = h('p', { class: 'field-msg', id: 'pub-tags-msg', 'aria-live': 'polite' });
  const save = () => host.setMeta('tags', tags.length ? [...tags] : undefined);
  const add = (raw: string) => {
    const t = cleanTag(raw);
    if (!t) return;
    if (tags.some((x) => tagKey(x) === tagKey(t))) { msg.textContent = `Already tagged “${t}”.`; return; }
    if (tags.length >= MAX_TAGS) { msg.textContent = `Up to ${MAX_TAGS} tags.`; return; }
    // reuse an existing tag's spelling so posts land on the same tag page
    const same = known.find((k) => tagKey(k.name) === tagKey(t));
    tags.push(same ? same.name : t);
    msg.textContent = '';
    save(); paint();
  };
  const remove = (i: number) => { tags.splice(i, 1); msg.textContent = ''; save(); paint(); input.focus(); };
  const paint = () => {
    // only the chips are rebuilt: moving the input would drop its focus
    chips.replaceChildren(
      ...tags.map((t, i) => h('span', { class: 'tag-chip' },
        h('span', { text: t }),
        h('button', { type: 'button', class: 'tag-x', 'aria-label': `Remove tag ${t}`, text: '×', on: { click: () => remove(i) } }),
      )),
    );
    if (input.parentNode !== box) box.append(input);
    input.placeholder = tags.length ? '' : 'Type a tag and press Enter';
    input.setAttribute('aria-label', 'Add a tag');
    const q = tagKey(input.value.trim());
    const opts = known.filter((k) => !tags.some((t) => tagKey(t) === tagKey(k.name)) && (!q || tagKey(k.name).startsWith(q))).slice(0, 8);
    // typing the start of an existing tag: Enter/Tab completes it (shown highlighted)
    hot = q && opts[0] ? opts[0].name : null;
    sugg.replaceChildren(...opts.map((k, i) => h('button', {
      type: 'button', class: 'tag-opt' + (hot && i === 0 ? ' hot' : ''), title: `${k.count} post${k.count === 1 ? '' : 's'}`,
      on: { mousedown: (e: Event) => e.preventDefault(), click: () => { add(k.name); input.value = ''; paint(); input.focus(); } },
    }, '+ ', k.name)));
    sugg.hidden = !opts.length;
  };
  input.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === 'Tab') && hot && input.value.trim()) { e.preventDefault(); e.stopPropagation(); add(hot); input.value = ''; paint(); }
    else if ((e.key === 'Enter' || e.key === ',') && input.value.trim()) { e.preventDefault(); e.stopPropagation(); add(input.value); input.value = ''; paint(); }
    else if (e.key === 'Enter') e.preventDefault(); // never submit the sheet from here
    else if (e.key === 'Backspace' && !input.value && tags.length) { e.preventDefault(); remove(tags.length - 1); }
  });
  input.addEventListener('input', () => {
    if (input.value.includes(',')) { input.value.split(',').slice(0, -1).forEach(add); input.value = input.value.split(',').pop() || ''; }
    paint();
  });
  input.addEventListener('blur', () => { if (input.value.trim()) { add(input.value); input.value = ''; paint(); } });
  box.addEventListener('click', (e) => { if (e.target === box || e.target === chips) input.focus(); });
  loadKnownTags().then((k) => { known = k; paint(); });
  paint();
  return h('div', {}, box, sugg, msg);
}

// ---------- dates ----------
const fmtDay = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(y !== new Date().getFullYear() ? { year: 'numeric' } : {}), timeZone: 'UTC' });
};
/** A post dated after today stays hidden until that day (the site rebuilds every night). */
export const isFuture = (ymd: string) => /^\d{4}-\d{2}-\d{2}$/.test(ymd) && ymd > today();

let styled = false;
function addStyles() {
  if (styled) return;
  styled = true;
  document.head.append(h('style', { text: `
.tag-box { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-height: 40px; padding: 5px 8px; border: 1px solid var(--rule); border-radius: 9px; background: #fff; cursor: text; }
.tag-box:focus-within { outline: 2px solid color-mix(in srgb, var(--link) 60%, transparent); border-color: var(--link); }
.tag-chips { display: contents; }
.tag-in { flex: 1; min-width: 120px; border: 0; outline: 0; font: inherit; font-size: 14px; padding: 4px 2px; background: transparent; color: var(--ink); }
.tag-chip { display: inline-flex; align-items: center; gap: 2px; font-size: 13px; line-height: 1.6; padding: 1px 4px 1px 10px; border-radius: 999px; background: var(--tile); border: 1px solid var(--rule); color: var(--ink); }
.tag-x { font: inherit; font-size: 15px; line-height: 1; width: 20px; height: 20px; border: 0; border-radius: 50%; background: none; color: var(--muted); cursor: pointer; }
.tag-x:hover { background: color-mix(in srgb, var(--ink) 8%, transparent); color: var(--ink); }
.tag-x:focus-visible, .tag-opt:focus-visible { outline: 2px solid var(--link); outline-offset: 1px; }
.tag-sugg { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.tag-sugg[hidden] { display: none; }
.tag-opt { font: inherit; font-size: 12.5px; line-height: 1.6; padding: 1px 10px; border-radius: 999px; border: 1px dashed color-mix(in srgb, var(--muted) 45%, transparent); background: none; color: var(--muted); cursor: pointer; }
.tag-opt.hot { color: var(--link); border-color: var(--link); border-style: solid; background: color-mix(in srgb, var(--link) 7%, transparent); }
.tag-opt:hover { color: var(--link); border-color: var(--link); border-style: solid; }
.publish-sheet .date-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.publish-sheet .date-row .field { max-width: 200px; }
.sched-note { font-size: 13px; color: var(--muted); margin: 0; }
.sched-note.on { color: var(--tag); }
` }));
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Thumbnail + Upload / Replace / Remove. Calls onChange after each change. */
export function coverField(host: SheetHost, onChange: () => void) {
  const wrap = h('div', { class: 'cover-field' });
  const status = h('p', { class: 'field-msg', 'aria-live': 'polite' });
  let busy = false;
  const paint = () => {
    const url = host.coverUrl();
    wrap.replaceChildren();
    const thumb = h('div', { class: 'cover-thumb' + (url ? '' : ' empty') });
    if (url) thumb.append(h('img', { src: url, alt: 'Current cover image' }));
    else thumb.append(h('span', { text: 'No cover' }));
    const btns = h('div', { class: 'cover-btns' });
    const up = h('button', { type: 'button', class: 'btn btn-ghost', text: busy ? 'Uploading…' : url ? 'Replace' : 'Upload cover', disabled: busy });
    up.addEventListener('click', async () => {
      const f = await pickFile('image/*');
      if (!f) return;
      busy = true; status.textContent = 'Uploading cover…'; status.className = 'field-msg'; paint();
      try {
        const r = await uploadImage(f, (host.slug() || 'post') + '-cover');
        host.setCover(r.src, r.preview);
        status.textContent = 'Cover added. The banner and link previews use it.';
        status.className = 'field-msg good';
        toast('Cover added', { kind: 'ok' });
      } catch (e) {
        status.textContent = (e as Error).message || 'Couldn’t upload the cover';
        status.className = 'field-msg bad';
      }
      busy = false; paint(); onChange();
    });
    btns.append(up);
    if (url) {
      btns.append(h('button', {
        type: 'button', class: 'btn btn-quiet', text: 'Remove', disabled: busy,
        on: { click: () => { host.removeCover(); status.textContent = 'Cover removed.'; status.className = 'field-msg'; paint(); onChange(); } },
      }));
    }
    wrap.append(thumb, h('div', {}, btns, h('p', { class: 'fine', text: 'Shown in link previews and used to tint the banner.' })));
  };
  paint();
  return h('div', {}, wrap, status);
}

export function openCoverDialog(host: SheetHost) {
  openDialog({ title: 'Cover image', size: 'sm', body: [coverField(host, () => {})], actions: [{ label: 'Done', value: 'done', kind: 'primary' }] });
}

export function openPublishSheet(host: SheetHost) {
  const updating = host.published();
  const locked = host.slugLocked();
  let slug = host.slug() || slugify(host.title()) || 'post';
  let slugOk = true;
  let checkSeq = 0;

  // --- slug ---
  const slugIn = h('input', { class: 'field slug-in', id: 'pub-slug', value: slug, autocomplete: 'off', spellcheck: 'false', readOnly: locked, 'aria-describedby': 'pub-slug-msg' });
  const slugMsg = h('p', { class: 'field-msg', id: 'pub-slug-msg', 'aria-live': 'polite' });
  const slugRow = h('div', { class: 'slug-row' + (locked ? ' locked' : '') }, h('span', { class: 'slug-pre', text: `${SITE_HOST}/blog/` }), slugIn);
  if (locked) slugMsg.textContent = 'The address stays the same after publishing, so links keep working.';
  let checkTimer = 0;
  const checkSlug = () => {
    if (locked) return;
    const v = slugIn.value.trim();
    clearTimeout(checkTimer);
    if (!v) { slugOk = false; slugMsg.textContent = 'The address can’t be empty.'; slugMsg.className = 'field-msg bad'; return paint(); }
    if (!SLUG_RE.test(v)) { slugOk = false; slugMsg.textContent = 'Use lowercase letters, numbers and single dashes.'; slugMsg.className = 'field-msg bad'; return paint(); }
    slug = v; host.setSlug(v);
    if (v === host.ownSlug()) { slugOk = true; slugMsg.textContent = ''; return paint(); }
    slugOk = false; slugMsg.textContent = 'Checking…'; slugMsg.className = 'field-msg';
    paint();
    const seq = ++checkSeq;
    checkTimer = window.setTimeout(async () => {
      try {
        const taken = await isSlugTaken(v);
        if (seq !== checkSeq) return;
        slugOk = !taken;
        slugMsg.textContent = taken ? 'Another post already uses this address. Try a different one.' : 'Available';
        slugMsg.className = 'field-msg ' + (taken ? 'bad' : 'good');
      } catch {
        if (seq !== checkSeq) return;
        slugOk = true; slugMsg.textContent = 'Couldn’t check the address right now.'; slugMsg.className = 'field-msg';
      }
      paint();
    }, 400);
  };
  slugIn.addEventListener('input', checkSlug);
  slugIn.addEventListener('blur', () => { if (!locked && slugIn.value && !SLUG_RE.test(slugIn.value)) { slugIn.value = slugify(slugIn.value); checkSlug(); } });

  // --- date / summary ---
  addStyles();
  const dateIn = h('input', { class: 'field', type: 'date', id: 'pub-date', value: host.date(), 'aria-describedby': 'pub-date-msg' });
  const dateNote = h('p', { class: 'sched-note', id: 'pub-date-msg', 'aria-live': 'polite' });
  dateIn.addEventListener('input', () => { if (dateIn.value) host.setDate(dateIn.value); paint(); });
  const scheduled = () => isFuture(host.date());
  const sumIn = h('textarea', { class: 'field', id: 'pub-sum', rows: '2', placeholder: 'One line about the post', value: host.summary() });
  const sumNudge = h('p', { class: 'field-msg' });
  sumIn.addEventListener('input', () => { host.setSummary(sumIn.value); paint(); });

  // --- preview card ---
  const card = h('div', { class: 'og-card', 'aria-label': 'Link preview' });
  const paintCard = () => {
    const img = host.coverUrl() || '/og.png';
    card.replaceChildren(
      h('div', { class: 'og-img' }, h('img', { src: img, alt: '' })),
      h('div', { class: 'og-txt' },
        h('div', { class: 'og-host', text: prettyUrl(slug) }),
        h('div', { class: 'og-title', text: host.title().trim() || 'Untitled' }),
        h('div', { class: 'og-desc' + (host.summary().trim() ? '' : ' empty'), text: host.summary().trim() || 'No summary yet' }),
      ),
    );
  };

  const field = (label: string, forId: string, ...kids: Node[]) => h('div', { class: 'fld' }, h('label', { class: 'label', for: forId, text: label }), ...kids);
  const cover = coverField(host, () => paint());
  const body = [
    field('Address', 'pub-slug', slugRow, slugMsg),
    field('Date', 'pub-date', h('div', { class: 'date-row' }, dateIn, dateNote)),
    field('Summary', 'pub-sum', sumIn, sumNudge),
    ...(host.meta && host.setMeta ? [field('Tags', 'pub-tags', tagField(host as Parameters<typeof tagField>[0]))] : []),
    h('div', { class: 'fld' }, h('span', { class: 'label', text: 'Cover' }), cover),
    h('div', { class: 'fld' }, h('span', { class: 'label', text: 'How the link will look' }), card),
  ];
  const fine = h('p', { class: 'fine' });
  body.push(fine);

  const finalLabel = () =>
    scheduled() ? (updating ? 'Update scheduled post' : `Schedule for ${fmtDay(host.date())}`)
    : updating ? 'Update live post' : `Publish to ${prettyUrl(slug)}`;
  const fineText = () =>
    scheduled()
      ? `Scheduled for ${fmtDay(host.date())}: the post stays hidden (not on the blog, RSS or search) until that morning, when the site rebuilds and it goes live at ${prettyUrl(slug)}. Until then, only the preview link works.`
      : updating ? 'Your edits replace the live post. The site redeploys in about 2 minutes.'
      : 'The post appears on the blog and in the RSS feed. The site redeploys in about 2 minutes.';
  const { ctl } = openDialog({
    title: updating ? (scheduled() ? 'Update the scheduled post' : 'Update the live post') : 'Publish',
    size: 'lg',
    className: 'publish-sheet',
    body,
    focus: locked ? '#pub-sum' : '#pub-slug',
    actions: [
      { label: 'Cancel', value: 'cancel', kind: 'ghost' },
      {
        label: finalLabel(), value: 'go', kind: 'primary', busyLabel: updating ? 'Updating…' : 'Publishing…',
        run: async () => {
          if (!host.title().trim()) throw new Error('Give the post a title first (close this and type it at the top).');
          if (!slugOk) throw new Error('Pick an available address first.');
          // editing a post that has been live for a while: note the date (shown as "Updated …")
          if (updating && host.setMeta && host.date() < today()) host.setMeta('updated', today());
          const r = await host.publish();
          if (r.ok || r.handled) return;
          throw new Error(r.message || 'Couldn’t publish');
        },
      },
    ],
  });

  function paint() {
    const go = ctl.buttons.go;
    if (go && !ctl.el.classList.contains('is-busy')) { go.textContent = finalLabel(); go.disabled = !slugOk; }
    sumNudge.textContent = sumIn.value.trim() ? '' : 'Tip: add a summary. It shows in link previews and the blog list.';
    dateNote.textContent = scheduled() ? `Scheduled · goes live ${fmtDay(host.date())}` : '';
    dateNote.className = 'sched-note' + (scheduled() ? ' on' : '');
    fine.textContent = fineText();
    paintCard();
  }
  if (!locked) checkSlug();
  paint();
}
