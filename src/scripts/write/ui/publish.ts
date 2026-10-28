// Publish sheet: slug, date, summary, cover, link-preview card, and a button
// that names exactly what will happen. Also the standalone cover dialog.
import { isSlugTaken, uploadImage } from '../github';
import { slugify } from '../lib';
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
};

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
  const dateIn = h('input', { class: 'field', type: 'date', id: 'pub-date', value: host.date() });
  dateIn.addEventListener('input', () => { if (dateIn.value) host.setDate(dateIn.value); });
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
    h('div', { class: 'fld-2' }, field('Date', 'pub-date', dateIn)),
    field('Summary', 'pub-sum', sumIn, sumNudge),
    h('div', { class: 'fld' }, h('span', { class: 'label', text: 'Cover' }), cover),
    h('div', { class: 'fld' }, h('span', { class: 'label', text: 'How the link will look' }), card),
    h('p', { class: 'fine', text: updating ? 'Your edits replace the live post. The site redeploys in about 2 minutes.' : 'The post appears on the blog and in the RSS feed. The site redeploys in about 2 minutes.' }),
  ];

  const finalLabel = () => (updating ? 'Update live post' : `Publish to ${prettyUrl(slug)}`);
  const { ctl } = openDialog({
    title: updating ? 'Update the live post' : 'Publish',
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
    paintCard();
  }
  if (!locked) checkSlug();
  paint();
}
