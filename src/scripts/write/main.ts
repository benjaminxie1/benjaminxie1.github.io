// The /write app shell: document state, saving semantics, top bar, and the
// dialogs (publish, posts, connect, history, conflict). Uses only the module
// contract (see CONTRACT.md): editor.ts for the writing surface, github.ts for
// the repo, local.ts for per-post drafts on this device, lib.ts for helpers.
import { mountBanner } from '../banner';
import { $, type Doc, blank, today, toDisplay, slugify, slugOf, store, OWNER, REPO } from './lib';
import { createEditor } from './editor';
import { smartPunctuation } from './editor/typing';
import { ConflictError, token, savePost, loadPost, deletePost, uploadImage, deployStatus } from './github';
import { saveLocal, loadLocal, keyOf, clearLocal, lastOpened, setLastOpened, type LocalEntry } from './local';
import { toMarkdown, unsupportedIn, parseMarkdown, splitFrontmatter } from './markdown';
import { h, download, pickFile } from './ui/dom';
import { openDialog, confirmDialog, choose } from './ui/dialog';
import { toast, announce } from './ui/toast';
import { connect } from './ui/connect';
import { openPublishSheet, openCoverDialog, type SheetHost } from './ui/publish';
import { openPosts, type PostRow } from './ui/posts';
import { openHistory } from './ui/history';
import { conflictDialog } from './ui/conflict';
import { attachMenu, type MenuItem } from './ui/menu';
import { fmtDate, fmtWhen, liveUrl, previewUrl, prettyUrl } from './ui/format';
import { createFindBar } from './editor/find';
import { createOutline, headings, jumpTo } from './editor/outline';
import { createFocus } from './editor/focus';
import { keyLabel } from './editor/ui';
import { watchPresence } from './ui/presence';

const ACTIONS_URL = `https://github.com/${OWNER}/${REPO}/actions`;
const ONBOARD_KEY = 'bx-write:onboard-dismissed';
const OUTLINE_KEY = 'bx-write:outline'; // '0' hides the margin outline
const TYPEWRITER_KEY = 'bx-write:typewriter';

// ---------- state ----------
let doc: Doc = blank();
let key = '';
let dirty = false; // differs from the repo copy (or never saved)
let rev = 0; // bumps on every edit, so edits typed during a save stay dirty
let localTimer = 0;
let localPending = false;
let localOk = true;
let localAt = 0;
type Busy = 'saving' | 'publishing' | 'updating' | 'unpublishing' | 'deleting';
let busy: Busy | null = null;
let failure: { msg: string; retry: () => void; label?: string } | null = null;
let deploy: { kind: 'draft' | 'live'; state: 'deploying' | 'live' | 'failed' | 'unknown' } | null = null;
let deployTimer = 0;
let deploySeq = 0;
let holdUntil = 0; // keep an important status visible for a moment before autosave messages
let holdTimer = 0;
let uploads = 0;
let coverPreview: string | null = null;
let presence: ReturnType<typeof watchPresence> | null = null;
let revAtShow = 0;
// Version ids for this device's copy, so two tabs on one post can tell whether the other
// tab's save builds on theirs (adopt quietly) or ran in parallel (ask).
let myV = '';
const newV = () => Math.random().toString(36).slice(2, 10); // rev when this post was loaded: no edits in this tab since → another tab's copy can be adopted
const sessionBase = new Map<string, number>(); // words per post when first opened in this tab

// ---------- elements ----------
const titleIn = $<HTMLTextAreaElement>('.title-in');
const dekIn = $<HTMLTextAreaElement>('.dek-in');
const dateIn = $<HTMLInputElement>('.date-in');
const dateBtn = $<HTMLButtonElement>('.m-date');
const mState = $('.m-state');
const urlLine = $('.url-line');
const pill = $('.wb-state');
const statsEl = $('.wb-stats');
const primaryBtn = $<HTMLButtonElement>('[data-act="primary"]');
const previewBtn = $<HTMLButtonElement>('[data-act="preview"]');
const postsBtn = $<HTMLButtonElement>('[data-act="posts"]');
const moreBtn = $<HTMLButtonElement>('[data-act="more"]');
const onboard = $('.onboard');
const remoteNote = $('.note.remote');
const offlineNote = $('.note.offline');
const tabsNote = $('.note.tabs');
const banner = mountBanner($('.post-banner'), { seed: 'new-post' });
const narrow = matchMedia('(max-width: 640px)');

const grow = (t: HTMLTextAreaElement) => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; };
// a stable id per never-saved post, so each new post has its own local draft
// (DATA's local.ts reads doc.localId; the stub read _localId)
const fresh = (): Doc => { const d = blank(); const id = Math.random().toString(36).slice(2, 11); (d as any).localId = id; (d as any)._localId = id; return d; };

// ---------- editor ----------
async function upload(file: File) {
  if (!token()) {
    const ok = await connect({ reason: 'Images are stored in the site’s GitHub repo, so adding one needs a GitHub connection. Your image is waiting; it uploads as soon as you connect.' });
    if (!ok) throw new Error('Connect GitHub to upload images');
  }
  return uploadImage(file, currentSlug() || 'post');
}
const ed = createEditor({
  element: $('.editor'),
  onChange: () => changed(),
  upload,
  onUploadsChange: (n) => { uploads = n; paint(); },
  onMessage: (msg, kind) => toast(msg, { kind: kind === 'error' ? 'error' : 'info' }),
  onSelectionChange: () => paintStats(),
});
const find = createFindBar(ed.editor);
const outline = createOutline(ed.editor, { enabled: () => store.get(OUTLINE_KEY) !== '0' });
const focusMode = createFocus(ed.editor);
if (store.get(TYPEWRITER_KEY) === '1') focusMode.setTypewriter(true);
/** Replace the body (new post, restore…): also refresh what reads it. */
function setBody(html: string) {
  find.hide(false);
  ed.setHTML(html);
  outline.refresh();
}

// ---------- derived ----------
function currentSlug() {
  if (doc.path && (doc.published || !doc.slug)) return slugOf(doc);
  return doc.slug || slugify(titleIn.value);
}
function collect() {
  doc.title = titleIn.value;
  doc.description = dekIn.value;
  doc.date = dateIn.value || today();
  doc.html = ed.getHTML();
}
const coverUrl = () => coverPreview || (doc.cover ? toDisplay(doc.cover) : null);

// ---------- loading a doc into the page ----------
function show(d: Doc, isDirty: boolean, savedAt = 0) {
  stopDeploy();
  failure = null; holdUntil = 0;
  clearTimeout(localTimer); localPending = false; localOk = true;
  doc = { ...d };
  if (doc.lossy === undefined) doc.lossy = unsupportedIn(doc.html || '');
  dirty = isDirty;
  localAt = savedAt || Date.now();
  key = keyOf(doc);
  coverPreview = null;
  titleIn.value = doc.title;
  dekIn.value = doc.description;
  dateIn.value = doc.date || today();
  setBody(doc.html || '');
  grow(titleIn); grow(dekIn);
  remoteNote.hidden = true;
  tabsNote.hidden = true;
  revAtShow = rev;
  myV = (doc as { _v?: string })._v || '';
  if (!sessionBase.has(key)) sessionBase.set(key, ed.stats().words);
  setLastOpened(key);
  presence?.moved();
  paintAll();
  if (doc.lossy?.length) toast(`Heads up: this post has ${doc.lossy.join(', ')}, which the editor can’t keep. Saving here will remove it, so edit this one on GitHub instead.`, { kind: 'error' });
}

// ---------- local autosave (per post) ----------
function changed() {
  rev++;
  dirty = true;
  localPending = true;
  clearTimeout(localTimer);
  localTimer = window.setTimeout(flushLocal, 400);
  paint();
  paintStats();
}
function flushLocal() {
  clearTimeout(localTimer);
  if (!localPending) return;
  collect();
  const v = newV();
  Object.assign(doc, { _base: myV, _v: v });
  myV = v;
  localOk = saveLocal(doc, dirty);
  localAt = Date.now();
  localPending = false;
  setLastOpened(key);
  paint();
}
// Title/summary typing: any DOM change elsewhere on the page (status pill, URL line, tab
// title) makes Chrome end the field's undo group, so ⌘Z would undo one letter at a time.
// Record the change now, repaint once typing pauses.
let fieldPaintTimer = 0;
const fieldPaint = () => { clearTimeout(fieldPaintTimer); paint(); paintStats(); paintMeta(); seedSoon(); };
for (const el of [titleIn, dekIn]) {
  el.addEventListener('input', () => {
    grow(el);
    rev++; dirty = true; localPending = true;
    clearTimeout(localTimer);
    localTimer = window.setTimeout(flushLocal, 400);
    clearTimeout(fieldPaintTimer);
    fieldPaintTimer = window.setTimeout(fieldPaint, 350);
  });
  el.addEventListener('blur', () => { if (fieldPaintTimer) fieldPaint(); });
}
smartPunctuation(titleIn);
smartPunctuation(dekIn);
titleIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); dekIn.focus(); } });
dekIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ed.focusStart(); } });
dateIn.addEventListener('input', () => { changed(); paintMeta(); });
dateBtn.addEventListener('click', () => {
  try { (dateIn as any).showPicker(); }
  catch { dateIn.classList.add('show'); dateIn.tabIndex = 0; dateIn.focus(); }
});
dateIn.addEventListener('blur', () => { dateIn.classList.remove('show'); dateIn.tabIndex = -1; });
let seedTimer = 0;
const seedSoon = () => { clearTimeout(seedTimer); seedTimer = window.setTimeout(paintBanner, 500); };
window.addEventListener('resize', () => { grow(titleIn); grow(dekIn); });
document.fonts?.ready.then(() => { grow(titleIn); grow(dekIn); });
window.addEventListener('pagehide', flushLocal);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushLocal(); });
window.addEventListener('beforeunload', (e) => {
  flushLocal();
  if (ed.isUploading() || !localOk) { e.preventDefault(); e.returnValue = ''; }
});

// ---------- painting ----------
type Pill = { text: string; kind: 'idle' | 'local' | 'busy' | 'ok' | 'warn' | 'error'; href?: string; action?: { label: string; run: () => void }; title?: string; local?: boolean };
function pillState(): Pill {
  const slug = currentSlug();
  if (busy) return { text: { saving: 'Saving draft…', publishing: 'Publishing…', updating: 'Updating…', unpublishing: 'Unpublishing…', deleting: 'Deleting…' }[busy], kind: 'busy' };
  if (failure) return { text: failure.msg, kind: 'error', action: { label: failure.label || 'Retry', run: failure.retry }, title: failure.msg };
  if (!localOk) return { text: 'Couldn’t save on this device', kind: 'error', title: 'Browser storage is full or blocked. Keep this tab open, or save to GitHub.' };
  if (uploads) return { text: uploads > 1 ? `Uploading ${uploads} images…` : 'Uploading image…', kind: 'busy' };
  if (dirty) {
    if (localPending) return { text: 'Unsaved changes', kind: 'local', local: true };
    if (doc.published) return { text: 'Edits not live yet', kind: 'warn', local: true, title: `Saved on this device (${fmtWhen(localAt)}). Use Update to publish them.` };
    return { text: `Saved on this device · ${fmtWhen(localAt)}`, kind: 'local', local: true, title: token() ? 'Save draft (⌘S) to keep it on GitHub too' : 'Connect GitHub to save it online and publish' };
  }
  if (deploy) {
    const { kind, state } = deploy;
    if (state === 'failed') return { text: 'Deploy failed', kind: 'error', href: ACTIONS_URL, title: 'The site build failed. Open GitHub Actions for details.' };
    if (kind === 'draft') {
      if (state === 'live') return { text: 'Draft saved · preview', kind: 'ok', href: previewUrl(slug), title: 'Unlisted preview: anyone with the link can see it' };
      if (state === 'unknown') return { text: 'Draft saved · preview in ~2 min', kind: 'ok', href: previewUrl(slug), title: 'The preview link works once the site redeploys (about 2 minutes)' };
      return { text: 'Draft saved · preview in ~2 min', kind: 'ok', title: 'The site is redeploying' };
    }
    if (state === 'live') return { text: 'Live', kind: 'ok', href: liveUrl(slug), title: prettyUrl(slug) };
    if (state === 'unknown') return { text: 'Live in ~2 min', kind: 'ok', href: liveUrl(slug), title: 'The site redeploys in about 2 minutes' };
    return { text: 'Published · deploying…', kind: 'busy', title: 'The site is redeploying' };
  }
  if (doc.published) return { text: 'Published', kind: 'ok', href: liveUrl(slug), title: prettyUrl(slug) };
  if (doc.path) return { text: 'Draft saved · preview', kind: 'ok', href: previewUrl(slug), title: 'Unlisted preview: anyone with the link can see it' };
  return { text: 'New post', kind: 'idle', title: 'Start writing; it saves on this device as you type' };
}

let lastPill = '';
function renderPill() {
  const p = pillState();
  if (p.local && Date.now() < holdUntil) {
    clearTimeout(holdTimer);
    holdTimer = window.setTimeout(renderPill, holdUntil - Date.now() + 20);
    return;
  }
  const sig = JSON.stringify([p.text, p.kind, p.href, !!p.action, p.title]);
  if (sig === lastPill) return;
  lastPill = sig;
  pill.dataset.kind = p.kind;
  pill.title = p.title || p.text;
  const kids: Node[] = [h('span', { class: 'dot', 'aria-hidden': 'true' })];
  if (p.href) {
    const ext = /^https?:/.test(p.href);
    kids.push(h('a', { class: 'st-text', href: p.href, target: '_blank', rel: 'noopener' }, p.text, h('span', { class: 'arr', 'aria-hidden': 'true', text: ' ↗' }), ext ? null : h('span', { class: 'sr-only', text: ' (opens in a new tab)' })));
  } else kids.push(h('span', { class: 'st-text', text: p.text }));
  if (p.action) {
    const a = p.action;
    kids.push(h('button', { type: 'button', class: 'st-act', text: a.label, on: { click: () => a.run() } }));
  }
  pill.replaceChildren(...kids);
}

function paintPrimary() {
  const connected = !!token();
  primaryBtn.disabled = !!busy;
  if (doc.published) {
    primaryBtn.textContent = 'Update';
    primaryBtn.dataset.tone = !connected ? 'off' : dirty ? 'hot' : 'calm';
    primaryBtn.title = dirty ? 'Publish your edits to the live post' : 'No unpublished edits';
  } else {
    primaryBtn.textContent = 'Publish…';
    primaryBtn.dataset.tone = connected ? 'main' : 'off';
    primaryBtn.title = connected ? 'Review and publish' : 'Connect GitHub to publish';
  }
}
function previewTarget(): string | null {
  const slug = currentSlug();
  if (doc.published) return liveUrl(slug);
  if (doc.path) return previewUrl(slug);
  return null;
}
function paintPreview() {
  const t = previewTarget();
  previewBtn.disabled = !t;
  previewBtn.title = !t ? 'Save a draft first to get a preview link'
    : doc.published ? (dirty ? 'Open the live post (your new edits aren’t in it yet)' : 'Open the live post')
    : 'Unlisted preview of the last saved draft: anyone with the link can see it';
}
function openPreview() {
  const t = previewTarget();
  if (!t) { toast('Save a draft first (⌘S) to get a preview link.'); return; }
  window.open(t, '_blank', 'noopener');
  if (!doc.published && dirty) toast('The preview shows your last saved draft. Save draft (⌘S) to update it.');
  else if (deploy && deploy.state !== 'live') toast('The site is redeploying; the page updates in about 2 minutes.');
}
function statsText() {
  const s = ed.stats();
  if (!s.words) return '';
  if (s.selected) return `${s.selected.toLocaleString()} of ${s.words.toLocaleString()} words`;
  return `${s.words.toLocaleString()} ${s.words === 1 ? 'word' : 'words'} · ${s.minutes} min read`;
}
let statsRaf = 0;
function paintStats() {
  cancelAnimationFrame(statsRaf);
  statsRaf = requestAnimationFrame(() => { statsEl.textContent = statsText(); });
}
function paintMeta() {
  mState.textContent = doc.published ? 'Published' : 'Draft ·';
  mState.classList.toggle('is-draft', !doc.published);
  const date = dateIn.value || today();
  dateBtn.textContent = fmtDate(date);
  dateBtn.setAttribute('aria-label', `Date: ${fmtDate(date)}. Change date`);
  const slug = currentSlug();
  urlLine.replaceChildren();
  if (!slug) return;
  if (doc.published) urlLine.append(h('a', { href: liveUrl(slug), target: '_blank', rel: 'noopener', text: prettyUrl(slug) }));
  else urlLine.append(h('span', { text: prettyUrl(slug) }), h('span', { class: 'url-note', text: ' · not published yet' }));
}
function paintBanner() {
  banner.set({ seed: currentSlug() || 'new-post', cover: coverUrl() } as any);
}
function paintOnboard() {
  onboard.hidden = !!token() || store.get(ONBOARD_KEY) === '1';
}
function paint() {
  renderPill();
  paintPrimary();
  paintPreview();
  document.title = `${dirty ? '• ' : ''}${titleIn.value.trim() || 'New post'} · Write`;
}
function paintAll() { paint(); paintMeta(); paintBanner(); paintStats(); paintOnboard(); }

// ---------- deploy status ----------
function stopDeploy() { deploySeq++; clearTimeout(deployTimer); deploy = null; }
function startDeploy(kind: 'draft' | 'live', afterIso: string, commitSha?: string) {
  stopDeploy();
  let fails = 0;
  const my = deploySeq;
  const started = Date.now();
  deploy = { kind, state: 'deploying' };
  const tick = async () => {
    if (my !== deploySeq || !deploy) return;
    let s: Awaited<ReturnType<typeof deployStatus>>;
    try { s = await (deployStatus as (a: string, c?: string) => ReturnType<typeof deployStatus>)(afterIso, commitSha); }
    catch { s = ++fails >= 3 ? 'unknown' : 'pending'; } // transient errors: keep polling a little
    if (my !== deploySeq || !deploy) return;
    if (s === 'live') { deploy.state = 'live'; holdUntil = Date.now() + 3000; announce(kind === 'live' ? 'The post is live.' : 'The draft preview is ready.'); }
    else if (s === 'failed') { deploy.state = 'failed'; announce('The site deploy failed.'); }
    else if (s === 'unknown' || Date.now() - started > 10 * 60e3) deploy.state = 'unknown';
    else deployTimer = window.setTimeout(tick, 10000);
    paint();
  };
  deployTimer = window.setTimeout(tick, 3000);
}

// ---------- saving to GitHub ----------
type Result = { ok: true } | { ok: false; message?: string; handled?: boolean };
async function commit(mode: 'draft' | 'publish' | 'unpublish', o: { force?: boolean } = {}): Promise<Result> {
  if (busy) return { ok: false, message: 'Still saving, one moment.' };
  if (navigator.onLine === false) {
    const m = 'You’re offline. Your writing is safe on this device; save to GitHub once you’re back online.';
    toast(m);
    return { ok: false, message: m };
  }
  if (!token()) {
    const ok = await connect({ reason: 'To save online and publish, connect GitHub once. Your writing is safe on this device meanwhile.' });
    if (!ok) return { ok: false, handled: true };
  }
  if (ed.isUploading()) {
    const m = 'Images are still uploading. Try again when they finish.';
    toast(m);
    return { ok: false, message: m };
  }
  collect();
  if (!doc.title.trim()) {
    toast('Give the post a title first.');
    titleIn.focus();
    return { ok: false, message: 'Give the post a title first.' };
  }
  if (doc.lossy?.length) {
    const c = await choose({
      title: 'Saving will change this post',
      message: `This post has ${doc.lossy.join(', ')}, which the editor can’t keep. If you save, ${doc.lossy.length > 1 ? 'they' : 'it'} will be removed${doc.published ? ' from the live post' : ''}.`,
      options: [{ label: 'Cancel', value: 'cancel' }, { label: 'Save and remove it', value: 'go', kind: 'danger' }],
    });
    if (c !== 'go') return { ok: false, handled: true };
  }
  flushLocal();
  const snap = rev;
  const oldKey = key;
  const afterIso = new Date().toISOString();
  const draft = mode !== 'publish';
  const wasPublished = doc.published;
  busy = mode === 'draft' ? 'saving' : mode === 'unpublish' ? 'unpublishing' : doc.published ? 'updating' : 'publishing';
  failure = null;
  holdUntil = 0;
  paint();
  try {
    let base: Doc = { ...doc };
    let renamedFrom: Doc | null = null;
    // A saved draft whose address was changed in the publish sheet: write the new file, then remove the old one.
    if (doc.path && !doc.published && doc.slug && doc.slug !== slugOf(doc)) { renamedFrom = { ...doc }; base = { ...doc, path: null, sha: null }; }
    if (!base.path) base.slug = doc.slug || slugify(doc.title) || 'post';
    const saved = await savePost(base, { draft, force: o.force });
    if (renamedFrom) await deletePost(renamedFrom).catch(() => toast('Saved, but the old draft file couldn’t be removed.', { kind: 'error' }));
    if (key !== oldKey) {
      // the editor moved to another post during the save: record the result for the saved post only
      const savedDoc: Doc = { ...base, path: saved.path, sha: saved.sha, draft: saved.draft, published: saved.published, extra: saved.extra ?? base.extra };
      delete savedDoc.slug;
      clearLocal(oldKey);
      saveLocal(savedDoc, false);
      busy = null;
      paintAll();
      return { ok: true };
    }
    doc = { ...doc, path: saved.path, sha: saved.sha, draft: saved.draft, published: saved.published, extra: saved.extra ?? doc.extra };
    delete doc.slug;
    doc.lossy = [];
    collect();
    dirty = rev !== snap; // typed during the save? keep it dirty
    key = keyOf(doc);
    if (key !== oldKey) {
      clearLocal(oldKey);
      if (renamedFrom?.path) clearLocal(renamedFrom.path);
    }
    localOk = saveLocal(doc, dirty);
    localAt = Date.now();
    setLastOpened(key);
    busy = null;
    holdUntil = Date.now() + 3500;
    const lc = (saved as { lastCommit?: { sha: string; date: string } }).lastCommit;
    startDeploy(draft ? 'draft' : 'live', lc?.date || afterIso, lc?.sha);
    const done = mode === 'unpublish' ? 'Unpublished. The post is a draft again.' : draft ? 'Draft saved to GitHub.' : wasPublished ? 'Live post updated.' : 'Published.';
    announce(done);
    if (mode === 'unpublish') toast(done);
    paintAll();
    return { ok: true };
  } catch (e) {
    busy = null;
    if (e instanceof ConflictError) {
      failure = { msg: 'Not saved · newer copy online', label: 'Resolve', retry: () => commit(mode) };
      paint();
      setTimeout(() => resolveConflict(mode, e), 0);
      return { ok: false, handled: true };
    }
    const msg = (e as Error).message || 'Couldn’t save';
    const kind = (e as { kind?: string }).kind;
    failure = kind === 'auth' || kind === 'access'
      ? { msg: `Not saved: ${msg}`, label: 'Reconnect', retry: () => connect().then((ok) => { if (ok) commit(mode, o); }) }
      : { msg: `Not saved: ${msg}`, retry: () => commit(mode, o) };
    announce(failure.msg);
    paint();
    return { ok: false, message: msg };
  }
}

function downloadMine() {
  collect();
  try { download(`${currentSlug() || 'post'}.md`, toMarkdown(doc)); }
  catch (e) { toast((e as Error).message || 'Couldn’t export this post', { kind: 'error' }); }
}
async function resolveConflict(mode: 'draft' | 'publish' | 'unpublish', err: ConflictError) {
  const choice = await conflictDialog({ title: doc.title, download: downloadMine });
  if (choice === 'load') {
    try {
      const remote = err.remote ?? (await loadPost(doc.path!));
      show(remote, false);
      saveLocal(remote, false);
      toast('Loaded the newer version.');
    } catch (e) { toast((e as Error).message || 'Couldn’t load the newer version', { kind: 'error' }); }
  } else if (choice === 'overwrite') {
    failure = null;
    await commit(mode, { force: true });
  }
  paint();
}

async function saveDraftCmd() {
  if (doc.published) {
    flushLocal();
    holdUntil = 0;
    paint();
    toast('Edits not live yet. Use Update to publish them.', { action: { label: 'Update…', run: openPublish } });
    return;
  }
  if (!token()) {
    flushLocal();
    toast('Saved on this device. Connect GitHub to save drafts online.', { action: { label: 'Connect', run: () => connect().then(() => paint()) } });
    return;
  }
  if (!dirty && doc.path) { toast('Draft already saved.'); return; }
  await commit('draft');
}

const sheetHost: SheetHost = {
  title: () => titleIn.value,
  summary: () => dekIn.value,
  date: () => dateIn.value || today(),
  slug: () => currentSlug(),
  slugLocked: () => doc.published,
  ownSlug: () => (doc.path ? slugOf(doc) : null),
  published: () => doc.published,
  hasCover: () => !!doc.cover,
  coverUrl,
  setSlug(s) { if (doc.published || s === currentSlug()) return; doc.slug = s; changed(); paintMeta(); seedSoon(); },
  setDate(d) { dateIn.value = d; changed(); paintMeta(); },
  setSummary(s) { dekIn.value = s; grow(dekIn); changed(); },
  setCover(src, preview) { doc.cover = src; coverPreview = preview; changed(); paintBanner(); },
  removeCover() { doc.cover = ''; coverPreview = null; changed(); paintBanner(); toast('Cover removed'); },
  publish: () => commit('publish'),
};

async function openPublish() {
  if (busy) return;
  if (navigator.onLine === false) { toast('You’re offline. Publish once you’re back online; your writing is safe on this device.'); return; }
  if (!token()) {
    const ok = await connect({ reason: 'To publish, connect GitHub once. Your writing is safe on this device meanwhile.' });
    if (!ok) return;
    paint();
  }
  if (ed.isUploading()) { toast('Images are still uploading. Publish when they finish.'); return; }
  if (!titleIn.value.trim()) { toast('Give the post a title first.'); titleIn.focus(); return; }
  collect();
  openPublishSheet(sheetHost);
}

async function coverCmd() {
  if (!token() && !(await connect({ reason: 'Cover images are stored in the site’s GitHub repo, so this needs a GitHub connection.' }))) return;
  openCoverDialog(sheetHost);
}

async function unpublishCmd() {
  const ok = await confirmDialog({
    title: 'Unpublish this post?',
    message: h('div', {},
      h('p', {}, h('b', { text: prettyUrl(currentSlug()) }), ' will stop working once the site redeploys (about 2 minutes). Anyone with the link will see “not found”.'),
      h('p', { text: 'The post becomes a draft again, including any edits you have here. You can publish it again later.' }),
    ),
    confirm: 'Unpublish',
    cancel: 'Keep it live',
    danger: true,
  });
  if (ok) await commit('unpublish');
}

// ---------- delete ----------
async function confirmDelete(t: { title: string; inRepo: boolean; published: boolean }) {
  const title = t.title.trim();
  const msg = t.published
    ? 'This removes the post from benxie.garden, and its link stops working. Its old versions stay in the GitHub repo’s history.'
    : t.inRepo ? 'This deletes the draft from GitHub and from this device.'
    : 'This post was never saved online, so deleting it from this device can’t be undone.';
  if (!t.inRepo || !title) return confirmDialog({ title: 'Delete this post?', message: msg, confirm: 'Delete post', cancel: 'Keep it', danger: true });
  const inp = h('input', { class: 'field', id: 'del-confirm', autocomplete: 'off', spellcheck: 'false' });
  const { ctl, result } = openDialog({
    title: `Delete “${title}”?`,
    size: 'sm',
    body: [h('p', { text: msg }), h('label', { class: 'label', for: 'del-confirm', text: 'Type the post title to confirm' }), inp],
    actions: [{ label: 'Keep it', value: 'no', kind: 'ghost' }, { label: 'Delete post', value: 'yes', kind: 'danger', disabled: true }],
    focus: inp,
  });
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  inp.addEventListener('input', () => { ctl.buttons.yes.disabled = norm(inp.value) !== norm(title); });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !ctl.buttons.yes.disabled) ctl.buttons.yes.click(); });
  return (await result) === 'yes';
}
async function removePost(t: { key: string; path: string | null; sha: string | null; title: string; inRepo: boolean; published: boolean }) {
  if (busy) { toast('Wait for the save to finish.'); return false; }
  if (!(await confirmDelete(t))) return false;
  const isCurrent = t.key === key;
  if (t.inRepo && t.path) {
    if (!token() && !(await connect())) return false;
    if (isCurrent) { busy = 'deleting'; paint(); }
    const target: Doc = isCurrent ? doc : { ...blank(), path: t.path, sha: t.sha, title: t.title, published: t.published, draft: !t.published };
    try {
      try { await deletePost(target); }
      catch (e) {
        if (!(e instanceof ConflictError)) throw e;
        busy = null; paint();
        const again = await confirmDialog({ title: 'This post changed somewhere else', message: 'It was saved again (on GitHub or another device) since you opened it. Delete it anyway, including those changes?', confirm: 'Delete anyway', cancel: 'Keep it', danger: true });
        if (!again) return false;
        if (isCurrent) { busy = 'deleting'; paint(); }
        await (deletePost as (d: Doc, o?: { force?: boolean }) => Promise<void>)(target, { force: true });
      }
    } catch (e) {
      busy = null; paint();
      toast(`Couldn’t delete: ${(e as Error).message}`, { kind: 'error' });
      return false;
    }
    busy = null;
  }
  clearLocal(t.key);
  if (isCurrent) show(fresh(), false);
  toast(`Deleted “${t.title.trim() || 'Untitled'}”`);
  return true;
}
const deleteCurrent = () => removePost({ key, path: doc.path, sha: doc.sha, title: titleIn.value, inRepo: !!doc.path, published: doc.published });

// ---------- posts panel ----------
/** Switching documents mid-save or mid-upload would bind results to the wrong post or drop images. */
function canSwitch(): boolean {
  if (busy) { toast('Wait for the save to finish.'); return false; }
  if (ed.isUploading()) { toast('Wait for images to finish uploading.'); return false; }
  return true;
}
async function openRow(r: PostRow): Promise<boolean> {
  if (!canSwitch()) return false;
  if (r.key === key) return true;
  flushLocal();
  const local = loadLocal(r.key);
  if (!r.inRepo) {
    if (!local) { toast('Couldn’t find that post on this device.', { kind: 'error' }); return false; }
    show(local.doc, local.dirty, local.savedAt);
    return true;
  }
  if (local?.dirty) {
    if (r.sha && local.doc.sha !== r.sha) {
      const c = await choose({
        title: 'This post has a newer version on the site',
        message: 'You have unsaved edits to this post on this device, but it was saved again somewhere else since then.',
        options: [
          { label: 'Use the version on the site', value: 'site', kind: 'ghost' },
          { label: 'Continue your local edits', value: 'local', kind: 'primary' },
        ],
      });
      if (!c) return false;
      if (c === 'local') { show(local.doc, true, local.savedAt); toast('Your local edits are based on an older version. Saving will ask before overwriting.'); return true; }
    } else {
      show(local.doc, true, local.savedAt);
      return true;
    }
  }
  try {
    const d = await loadPost(r.path!);
    show(d, false);
    saveLocal(d, false);
    return true;
  } catch (e) {
    if (local) { show(local.doc, local.dirty, local.savedAt); toast('Couldn’t reach GitHub, so this is the copy saved on this device.'); return true; }
    toast((e as Error).message || 'Couldn’t open the post', { kind: 'error' });
    return false;
  }
}
function newPost() {
  if (!canSwitch()) return;
  flushLocal();
  show(fresh(), false);
  titleIn.focus();
}
function postsCmd() {
  if (document.querySelector('dialog[open]')) return;
  flushLocal();
  openPosts({
    currentKey: () => key,
    open: openRow,
    newPost,
    remove: (r) => removePost({ key: r.key, path: r.path, sha: r.sha, title: r.title, inRepo: r.inRepo, published: !r.draft }),
    connect: () => connect().then((ok) => { paint(); return ok; }),
  });
}
postsBtn.addEventListener('click', postsCmd);

// ---------- top bar ----------
primaryBtn.addEventListener('click', openPublish);
previewBtn.addEventListener('click', openPreview);
const wideOutline = matchMedia('(min-width: 1180px)');
attachMenu(moreBtn, () => {
  const hs = headings(ed.editor);
  const outlineOn = store.get(OUTLINE_KEY) !== '0';
  const items: (MenuItem | null)[] = [
    narrow.matches && statsText() ? { label: 'Word count', note: statsText(), run: statsCmd } : null,
    narrow.matches ? { label: 'Preview', run: openPreview, disabled: !previewTarget(), note: previewTarget() ? undefined : 'Save a draft first' } : null,
    !doc.published ? { label: 'Save draft', hint: keyLabel('Mod-s'), run: saveDraftCmd, note: token() ? undefined : 'Saves on this device until you connect' } : null,
    { sep: true },
    { label: 'Find and replace', hint: keyLabel('Mod-f'), run: () => find.show() },
    wideOutline.matches
      ? { label: 'Outline in the margin', checked: outlineOn, run: () => { store.set(OUTLINE_KEY, outlineOn ? '0' : '1'); outline.refresh(); }, note: hs.length < 2 ? 'Appears once there are two headings' : undefined }
      : { label: 'Outline…', run: outlineCmd, disabled: !hs.length, note: hs.length ? `${hs.length} heading${hs.length > 1 ? 's' : ''}` : 'Add a heading (##) to see it here' },
    { label: 'Focus mode', checked: focusMode.focus, hint: keyLabel('Mod-.'), run: () => toggleFocus() },
    { label: 'Typewriter scrolling', checked: focusMode.typewriter, run: () => { focusMode.setTypewriter(!focusMode.typewriter); store.set(TYPEWRITER_KEY, focusMode.typewriter ? '1' : '0'); } },
    { sep: true },
    { label: doc.cover ? 'Cover image…' : 'Add a cover image…', run: coverCmd },
    { label: 'Version history', run: () => doc.path && openHistory(doc.path, restoreVersion), disabled: !doc.path || !token(), note: doc.path ? undefined : 'Available after the first save' },
    { label: 'Duplicate post', run: duplicateCmd, disabled: !titleIn.value.trim() && !ed.stats().words },
    { label: 'Import a Markdown file…', run: importCmd },
    { label: 'Export as Markdown', run: downloadMine, disabled: !titleIn.value.trim() && !ed.stats().words },
    { sep: true },
    doc.published ? { label: 'Unpublish…', run: unpublishCmd, danger: true } : null,
    { label: 'Delete post…', run: deleteCurrent, danger: true, disabled: !doc.path && !titleIn.value.trim() && !ed.stats().words },
    { sep: true },
    { label: 'Keyboard shortcuts', hint: keyLabel('Mod-/'), run: () => ed.openShortcuts() },
    { label: 'GitHub connection', note: token() ? 'Connected' : 'Not connected', run: () => connect().then(() => paint()) },
  ];
  // no leading, trailing or doubled separators
  return (items.filter(Boolean) as MenuItem[]).filter((it, i, a) => !('sep' in it) || (i > 0 && !('sep' in a[i - 1]) && i < a.length - 1));
});

// ---------- writing tools: focus, outline, word count, import/export, duplicate ----------
function toggleFocus() {
  focusMode.toggleFocus();
  if (focusMode.focus) toast(`Focus mode. The bar fades while you type; ${keyLabel('Mod-.')} to leave.`, { ms: 2600 });
  else toast('Focus mode off', { ms: 1400 });
}
function outlineCmd() {
  const hs = headings(ed.editor);
  if (!hs.length) { toast('Add a heading (type ## and a space) to build an outline.'); return; }
  const list = h('ol', { class: 'outline-list' });
  const { ctl } = openDialog({ title: 'Outline', size: 'sm', className: 'outline-dlg', body: list });
  hs.forEach((x) => list.append(h('li', { class: 'lv' + x.level },
    h('button', { type: 'button', class: 'outline-item', text: x.text || 'Untitled heading', on: { click: () => { ctl.close('go'); setTimeout(() => jumpTo(ed.editor, x.pos), 0); } } }))));
  (list.querySelector('button') as HTMLButtonElement | null)?.focus();
}
function statsCmd() {
  const s = ed.stats();
  const d = ed.editor.state.doc;
  const text = d.textBetween(0, d.content.size, '\n', '');
  let paras = 0, heads = 0, images = 0, links = 0;
  d.descendants((n) => {
    if (n.type.name === 'paragraph' && n.textContent.trim()) paras++;
    else if (n.type.name === 'heading') heads++;
    else if (n.type.name === 'figure') images++;
    if (n.isText && n.marks.some((m) => m.type.name === 'link')) links++;
    return true;
  });
  const base = sessionBase.get(key) ?? s.words;
  const delta = s.words - base;
  const n = (x: number) => x.toLocaleString();
  const rows: [string, string][] = [
    ['Words', n(s.words)],
    ...(s.selected ? [['Selected', `${n(s.selected)} words`] as [string, string]] : []),
    ['Characters', n(text.replace(/\n/g, '').length)],
    ['Characters without spaces', n(text.replace(/\s/g, '').length)],
    ['Paragraphs', n(paras)],
    ['Headings', n(heads)],
    ['Images', n(images)],
    ['Reading time', s.words ? `about ${s.minutes} min` : '–'],
    ['Written this session', `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${n(Math.abs(delta))} words`],
  ];
  if (dirty || doc.path) rows.push(['Last saved on this device', fmtWhen(localAt)]);
  openDialog({
    title: 'Word count', size: 'sm', className: 'stats-dlg',
    body: h('dl', { class: 'stats-grid' }, ...rows.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })])),
    actions: [{ label: 'Done', value: 'ok', kind: 'ghost' }],
  });
}
statsEl.addEventListener('click', statsCmd);

function duplicateCmd() {
  if (!canSwitch()) return;
  collect();
  flushLocal();
  const copy: Doc = { ...fresh(), title: doc.title.trim() ? `Copy of ${doc.title.trim()}` : '', description: doc.description, cover: doc.cover, html: doc.html, extra: doc.extra ? { ...doc.extra } : undefined };
  show(copy, true);
  localPending = true;
  flushLocal();
  toast('Duplicated. The copy is a new draft on this device.');
}
async function importCmd() {
  if (!canSwitch()) return;
  const f = await pickFile('.md,.markdown,.mdx,.txt,text/markdown,text/plain');
  if (!f) return;
  if (f.size > 3e6) { toast('That file is too large to import (3 MB max).', { kind: 'error' }); return; }
  let d: Doc;
  try {
    let text = await f.text();
    // no title in the frontmatter but the file starts with "# Title": use that as the post title
    const { fm, body } = splitFrontmatter(text);
    let title = '';
    if (!fm || !/^title\s*:/m.test(fm)) {
      const m = body.match(/^\s*#\s+(.+?)\s*#*\s*(?:\r?\n|$)/);
      if (m) { title = m[1]; text = (fm != null ? `---\n${fm}\n---\n` : '') + body.slice(m[0].length); }
    }
    d = parseMarkdown(text, null, null);
    if (!d.title) d.title = title || f.name.replace(/\.(md|markdown|mdx|txt)$/i, '').replace(/[-_]+/g, ' ').trim();
  } catch (e) {
    toast(`Couldn’t import ${f.name}: ${(e as Error).message}`, { kind: 'error' });
    return;
  }
  flushLocal();
  const n = fresh();
  show({ ...d, path: null, sha: null, published: false, draft: true, localId: n.localId, ...({ _localId: n.localId } as object) } as Doc, true);
  localPending = true;
  flushLocal();
  if (!doc.lossy?.length) toast(`Imported “${doc.title}” as a new draft on this device.`);
}

// ---------- other tabs & the network ----------
function paintOffline() {
  const off = navigator.onLine === false;
  offlineNote.hidden = !off;
  if (off) offlineNote.replaceChildren(h('p', {}, h('b', { text: 'You’re offline.' }), ' Your writing keeps saving on this device. Saving to GitHub and publishing will work again once you’re back online.'));
}
function onOtherTab(e: LocalEntry) {
  const theirs = e.doc;
  const mine = theirs.path ? theirs.path === doc.path : !doc.path && !!theirs.localId && theirs.localId === doc.localId;
  // a new post the other tab just saved to GitHub: it moved from new:<id> to its file path
  const moved = !!theirs.path && !doc.path && !!theirs.localId && theirs.localId === doc.localId;
  if (!(mine || moved) || busy) return;
  if (theirs.html === ed.getHTML() && theirs.title === titleIn.value && theirs.description === dekIn.value && theirs.sha === doc.sha && theirs.path === doc.path) return;
  const tv = theirs as { _v?: string; _base?: string };
  const quiet = !localPending && (rev === revAtShow || (!!myV && (tv._base === myV || tv._v === myV)));
  if (quiet) {
    const y = window.scrollY;
    const hadFocus = ed.editor.isFocused;
    const sel = ed.editor.state.selection.head;
    show(theirs, e.dirty, e.savedAt);
    window.scrollTo(0, y);
    if (hadFocus) { try { ed.editor.commands.focus(Math.min(sel, ed.editor.state.doc.content.size - 1), { scrollIntoView: false }); } catch {} }
    if (document.visibilityState === 'visible' && Date.now() - tabToastAt > 60e3) { tabToastAt = Date.now(); toast('Updated with changes from your other tab.'); }
    return;
  }
  tabsNote.dataset.kind = 'change';
  tabsNote.replaceChildren(
    h('p', {}, h('b', { text: 'This post was also changed in another tab.' }), ' If you keep typing here, this tab’s version replaces it.'),
    h('div', { class: 'note-btns' },
      h('button', { type: 'button', class: 'btn btn-ghost', text: 'Use the other tab’s version', on: { click: () => { show(theirs, e.dirty, e.savedAt); toast('Loaded the other tab’s version.'); } } }),
      h('button', { type: 'button', class: 'btn btn-quiet', text: 'Keep this one', on: { click: () => { tabsNote.hidden = true; changed(); } } }),
    ),
  );
  tabsNote.hidden = false;
}
let peerNoteDismissed = '';
let tabToastAt = 0;
function onPeers(n: number) {
  if (!n) { if (tabsNote.dataset.kind === 'peer') tabsNote.hidden = true; return; }
  if (!tabsNote.hidden || peerNoteDismissed === key) return;
  tabsNote.dataset.kind = 'peer';
  tabsNote.replaceChildren(
    h('p', {}, h('b', { text: 'Also open in another tab.' }), ' Changes made there show up here. Editing in one tab at a time is safest.'),
    h('div', { class: 'note-btns' }, h('button', { type: 'button', class: 'btn btn-quiet', text: 'Got it', on: { click: () => { peerNoteDismissed = key; tabsNote.hidden = true; } } })),
  );
  tabsNote.hidden = false;
}

function restoreVersion(d: Doc) {
  if (!canSwitch()) return;
  titleIn.value = d.title;
  dekIn.value = d.description;
  dateIn.value = d.date || today();
  doc.cover = d.cover;
  coverPreview = null;
  setBody(d.html || '');
  grow(titleIn); grow(dekIn);
  changed();
  paintMeta(); paintBanner();
  toast(doc.published ? 'Version restored as unsaved edits. Use Update to make it live.' : 'Version restored as unsaved changes. Save draft to keep it.');
}

window.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod || e.altKey) return;
  const k = e.key.toLowerCase();
  const modal = !!document.querySelector('dialog[open]');
  if (k === 's' && !e.shiftKey) {
    e.preventDefault();
    if (modal) return;
    saveDraftCmd();
  } else if (k === 'f' && !e.shiftKey) {
    if (modal) return; // inside a dialog, let the browser find
    e.preventDefault();
    find.show();
  } else if (k === 'g' && find.isOpen() && !modal) {
    e.preventDefault();
    if (e.shiftKey) find.prev(); else find.next();
  } else if (k === 'o' && !e.shiftKey) {
    e.preventDefault();
    postsCmd();
  } else if (e.key === '.' && !e.shiftKey) {
    if (modal) return;
    e.preventDefault();
    toggleFocus();
  }
});

// ---------- onboarding ----------
$('[data-act="connect"]').addEventListener('click', () => connect().then(() => paintAll()));
$('[data-act="dismiss-onboard"]').addEventListener('click', () => { store.set(ONBOARD_KEY, '1'); paintOnboard(); titleIn.focus(); });
window.addEventListener('bx-token', () => { paintOnboard(); paint(); });

// ---------- remote-newer banner (startup check) ----------
function offerRemote(remote: Doc) {
  remoteNote.replaceChildren(
    h('p', {}, h('b', { text: 'This post changed on the site' }), ' since you made the edits on this device.'),
    h('div', { class: 'note-btns' },
      h('button', { type: 'button', class: 'btn btn-ghost', text: 'Use the site version', on: { click: () => { show(remote, false); saveLocal(remote, false); toast('Loaded the version from the site.'); } } }),
      h('button', { type: 'button', class: 'btn btn-quiet', text: 'Keep my edits', on: { click: () => { doc.sha = remote.sha; remoteNote.hidden = true; changed(); toast('Keeping your edits. Saving will replace the site version.'); } } }),
      h('button', { type: 'button', class: 'linkish', text: 'Download mine as .md', on: { click: downloadMine } }),
    ),
  );
  remoteNote.hidden = false;
}
async function checkRemote() {
  const path = doc.path, k = key, mySha = doc.sha;
  if (!path || !token()) return;
  const remote = await loadPost(path).catch(() => null);
  if (!remote || key !== k || remote.sha === mySha) return;
  if (!dirty) { show(remote, false); saveLocal(remote, false); return; }
  offerRemote(remote);
}

// ---------- start ----------
{
  presence = watchPresence({ key: () => key, onPeers, onLocalChange: onOtherTab, onNetwork: (on) => { paintOffline(); if (on) toast('Back online.'); } });
  paintOffline();
  const lk = lastOpened();
  const entry = lk ? loadLocal(lk) : null;
  if (entry) show({ ...blank(), ...entry.doc }, entry.dirty, entry.savedAt);
  else show(fresh(), false);
  checkRemote();
  if (!titleIn.value) titleIn.focus();
}
