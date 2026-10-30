// Site mode of /write: edit Home, Experience and Contact in place. The real page loads in a
// same-origin iframe; layer.ts makes its [data-edit] text editable, items.ts adds item
// controls (add, duplicate, delete, reorder), structure.ts keeps the page's lists in step
// with the state, bindings.ts repaints details; inspector.ts is the Details panel for every
// schema field; state.ts tracks the working copy per JSON file, undo/redo, autosave and
// publishing.
import { $, OWNER, REPO, store } from '../lib';
import { token, deployStatus } from '../github';
import { h } from '../ui/dom';
import { openDialog, confirmDialog } from '../ui/dialog';
import { toast, announce } from '../ui/toast';
import { connect } from '../ui/connect';
import { attachMenu, type MenuItem } from '../ui/menu';
import { fmtWhen, SITE_HOST } from '../ui/format';
import { keyLabel } from '../editor/ui';
import { attachLayer, type Layer } from './layer';
import { attachStructure, type Structure } from './structure';
import { attachItems } from './items';
import { applyBindings } from './bindings';
import { createSiteState, type Problem, type ChangeEvent, type Change } from './state';
import { openReview } from './review';
import { createInspector } from './inspector';
import { createImages } from './images';
import { parseKey, split, isIndex, tokens, join, keyOf, FILE_RE, type Key } from './pointer';
import { listAt, itemLabel, summary, newItemFor, fileLabel, crumbs } from './fields';

const PAGES = [
  { id: 'home', label: 'Home', path: '/' },
  { id: 'experience', label: 'Experience', path: '/experience/' },
  { id: 'contact', label: 'Contact', path: '/contact/' },
] as const;
type PageId = (typeof PAGES)[number]['id'];
const PAGE_KEY = 'bx-write:site-page';
const PHONE_KEY = 'bx-write:site-phone';
const ACTIONS_URL = `https://github.com/${OWNER}/${REPO}/actions`;
const trim = (p: string) => p.replace(/\/+$/, '') || '/';
const listOf = (k: Key) => k.slice(0, k.lastIndexOf('/'));
const indexOf = (k: Key) => +k.slice(k.lastIndexOf('/') + 1);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const fmtVal = (v: unknown) => (v === undefined ? '(not shown)' : typeof v === 'string' ? v || '(empty)' : typeof v === 'boolean' ? (v ? 'On' : 'Off') : typeof v === 'number' ? String(v) : 'Changed');

export function startSite() {
  // ---------- elements ----------
  const pill = $('.ss-state');
  const pubBtn = $<HTMLButtonElement>('[data-act="site-publish"]');
  const moreBtn = $<HTMLButtonElement>('[data-act="site-more"]');
  const undoBtn = $<HTMLButtonElement>('[data-act="site-undo"]');
  const redoBtn = $<HTMLButtonElement>('[data-act="site-redo"]');
  const detBtn = $<HTMLButtonElement>('[data-act="site-details"]');
  const tabs = $('.spages');
  const note = $('.s-note');
  const stage = $('.s-stage');
  const frame = $<HTMLIFrameElement>('.s-frame');
  const hint = $('.s-hint');
  const panel = $('.s-panel');

  // ---------- state ----------
  let page: PageId = (PAGES.find((p) => p.id === store.get(PAGE_KEY))?.id) || 'home';
  let layer: Layer | null = null;
  let structure: Structure | null = null;
  let items: ReturnType<typeof attachItems> | null = null;
  let active = false;
  let loadingFiles = false;
  let pageFiles: string[] = [];
  let busy = false;
  let failure: { msg: string; label?: string; retry: () => void } | null = null;
  let deploy: { state: 'deploying' | 'live' | 'failed' | 'unknown'; page: PageId } | null = null;
  let deployTimer = 0, deploySeq = 0;
  let review: ReturnType<typeof openReview> | null = null;
  let attached: (() => void) | null = null;
  let sel: { file: string; id: string } | null = null;

  const st = createSiteState(onState);
  const images = createImages({ repaint: () => { layer?.refresh(); inspector.paint({ keys: [], structural: false, files: [], source: 'save' }); review?.paint(); }, origin: () => location.origin });
  const doc = () => { try { return frame.contentDocument; } catch { return null; } };
  const bind = () => { const d = doc(); if (d && layer) applyBindings(d, { get: (k) => st.get(k) }); };

  function onState(e: ChangeEvent) {
    if (layer) {
      if (e.structural || e.keys === null) { structure?.reconcile(); layer.refresh(); }
      else if (e.keys.length) layer.update(e.keys);
      bind();
      items?.paint();
    }
    inspector.paint(e);
    if (e.source !== 'save' || review) review?.paint();
    paint();
  }

  const host = {
    value: (k: Key) => st.value(k),
    get: (k: Key) => st.get(k),
    imgSrc: (p: string, k: Key) => images.src(p, k),
    loaded: (k: Key) => { const p = parseKey(k); return !!p && (st.files.has(p.file) || st.failed.has(p.file)); },
    changed: (k: Key) => st.changed(k),
    set: (k: Key, v: string) => { st.set(k, v, { typing: true }); },
    beginEdit: (k: Key) => st.beginEdit(k),
    endEdit: () => st.endEdit(),
    editable: () => !!token() && !busy,
    command: (c: 'save' | 'undo' | 'redo') => (c === 'save' ? reviewCmd() : c === 'undo' ? undoCmd() : redoCmd()),
    message: (m: string) => toast(m, { ms: 2600 }),
  };

  const selectedKey = () => (sel ? st.keyOfId(sel.file, sel.id) : null);
  function select(k: Key | null, follow = true) {
    const p = parseKey(k);
    const id = k ? st.idOf(k) : undefined;
    const next = p && id ? { file: p.file, id } : null;
    if (next?.id === sel?.id && next?.file === sel?.file) return;
    sel = next;
    items?.paint();
    if (follow) inspector.follow(k);
  }

  // ---------- structure operations ----------
  const limits = (L: Key) => { const p = parseKey(L); const l = p && listAt(p.file, p.ptr); return { min: l?.min ?? 0, max: l?.max ?? Infinity }; };
  const count = (L: Key) => { const a = st.get(L); return Array.isArray(a) ? a.length : 0; };
  const labelOf = (L: Key) => { const p = parseKey(L); return p ? itemLabel(p.file, p.ptr) : 'item'; };
  const nameOf = (k: Key) => { const p = parseKey(k); const s = p && split(p.ptr); return p && s ? summary(p.file, s.parent, +s.last, st.get(k)) : ''; };
  function addItem(L: Key, at?: number, fromPanel = false): Key | null {
    const p = parseKey(L);
    const l = p && listAt(p.file, p.ptr);
    if (!p || !l) return null;
    const n = count(L);
    if (n >= (l.max ?? Infinity)) { toast(`At most ${l.max} ${l.itemLabel}s here.`); return null; }
    const k = st.insert(L, at ?? n, newItemFor(l), { label: `Add ${l.itemLabel}` });
    if (!k) return null;
    announce(`Added a ${l.itemLabel}.`);
    select(k, !fromPanel);
    return k;
  }
  function addFromPage(L: Key) {
    const k = addItem(L);
    if (!k) return;
    setTimeout(() => {
      items?.scrollTo(k);
      // start typing in the new item's first text, or open its details when it has none
      const d = doc();
      const el = d?.querySelector<HTMLElement>(`[data-edit-item="${CSS.escape(k)}"]`);
      const f = el && (el.matches('[data-edit][contenteditable]') ? el : el.querySelector<HTMLElement>('[data-edit][contenteditable]'));
      if (f) { f.focus({ preventScroll: true }); const r = d!.createRange(); r.selectNodeContents(f); const s = d!.getSelection(); s?.removeAllRanges(); s?.addRange(r); }
      else inspector.open(k);
    }, 30);
  }
  function removeItem(k: Key) {
    const L = listOf(k), i = indexOf(k);
    const lab = labelOf(L), name = nameOf(k);
    if (count(L) <= limits(L).min) { toast(`Keep at least ${limits(L).min} ${lab}${limits(L).min === 1 ? '' : 's'}.`); return; }
    st.remove(L, i, `Delete ${lab}`);
    if (selectedKey() === null) sel = null;
    toast(`Deleted ${lab} “${name}”.`, { action: { label: 'Undo', run: undoCmd } });
    announce(`Deleted ${lab}. Press ${keyLabel('Mod-z')} to undo.`);
  }
  function moveItem(L: Key, from: number, to: number) {
    const id = st.idOf(`${L}/${from}`);
    if (!st.move(L, from, to, `Move ${labelOf(L)}`)) return;
    const p = parseKey(L)!;
    const k = id ? st.keyOfId(p.file, id) : null;
    items?.follow(k);
    const msg = `Moved ${labelOf(L)} to ${to + 1} of ${count(L)}.`;
    items?.say(msg); announce(msg);
  }

  const inspector = createInspector(panel, {
    st, images,
    pageFiles: () => [...pageFiles.filter((f) => f !== 'site'), ...(pageFiles.includes('site') ? ['site'] : [])],
    select: (k) => { sel = null; select(k, false); },
    showInPage: (k) => { if (!items?.scrollTo(k)) toast('That isn’t visible on this page.'); },
    removeItem,
    addItem: (L) => addItem(L, undefined, true),
    editable: () => !!token() && !busy,
    issues: () => st.issues(),
    closed: () => { paint(); (frame.contentWindow as Window | null)?.focus(); },
  });

  // ---------- the iframe ----------
  const pageOf = (id: PageId) => PAGES.find((p) => p.id === id)!;
  function load(id: PageId): Promise<void> {
    page = id;
    store.set(PAGE_KEY, id);
    items?.destroy(); items = null;
    layer?.destroy(); layer = null; structure = null;
    paintTabs();
    note.hidden = true;
    stage.classList.add('is-loading');
    const done = new Promise<void>((r) => (attached = r));
    frame.src = pageOf(id).path;
    return done;
  }
  frame.addEventListener('load', async () => {
    const win = frame.contentWindow;
    let d: Document | null = null;
    try { d = win?.document ?? null; } catch {}
    const want = pageOf(page);
    if (!win || !d || trim(win.location.pathname) !== trim(want.path)) {
      if (win && d) { toast('That link would leave the page, so it stays here while you edit.'); frame.src = want.path; }
      return;
    }
    items?.destroy(); layer?.destroy();
    structure = attachStructure(d, { idsOf: (L) => st.idsOf(L), cloneOf: st.cloneOf });
    layer = attachLayer(win, host);
    items = attachItems(win, {
      editable: () => !!token() && !busy,
      ready: (L) => { const p = parseKey(L); return !!p && st.loaded(p.file) && !st.held(p.file) && Array.isArray(st.get(L)); },
      count, limits, label: labelOf,
      canAdd: (L) => !!structure?.canAdd(L),
      add: addFromPage,
      duplicate: (k) => { const n = st.duplicate(k); if (n) { select(n); setTimeout(() => items?.scrollTo(n), 30); announce(`Duplicated ${labelOf(listOf(k))}.`); } },
      remove: removeItem,
      move: (L, a, b) => moveItem(L, a, b),
      details: (k, focus) => inspector.open(k, focus),
      select,
      selected: selectedKey,
    });
    const files = new Set<string>();
    d.querySelectorAll('[data-edit], [data-edit-href], [data-edit-list], [data-edit-img], [data-edit-item]').forEach((el) => {
      for (const a of ['data-edit', 'data-edit-href', 'data-edit-list', 'data-edit-img', 'data-edit-item']) { const p = parseKey(el.getAttribute(a)); if (p && FILE_RE.test(p.file)) files.add(p.file); }
    });
    pageFiles = [...files];
    stage.classList.remove('is-loading');
    attached?.(); attached = null;
    paintNote();
    if (st.files.size) { structure.reconcile(); layer.refresh(); bind(); }
    inspector.render();
    await loadFiles();
  });
  async function loadFiles() {
    if (!token()) { paint(); paintNote(); return; }
    loadingFiles = true; paint();
    const problems = await st.ensure([...pageFiles, ...st.orphaned()]);
    loadingFiles = false;
    structure?.reconcile(); layer?.refresh(); bind(); items?.paint();
    paint(); paintNote(); paintTabs();
    inspector.render();
    for (const p of problems) await askRestore(p);
  }
  async function askRestore(p: Problem) {
    const file = `${p.file}.json`;
    if (p.kind === 'fields') {
      const cs = p.conflicts;
      const list = h('ul', { class: 'rv-rows rv-compact' }, ...cs.slice(0, 6).map((c) => h('li', { class: 'rv-row' },
        h('div', { class: 'rv-top' }, h('span', { class: 'rv-key', text: crumbs(c.file, c.ptr, st.get(`${c.file}:`)).join(' › ') })),
        h('p', { class: 'rv-v rv-old' }, h('span', { class: 'rv-tag', text: 'GitHub ' }), fmtVal(c.theirs)),
        h('p', { class: 'rv-v rv-new' }, h('span', { class: 'rv-tag', text: 'Yours ' }), fmtVal(c.mine)))));
      const { result } = openDialog({
        title: 'Some text changed on GitHub', size: 'md',
        body: [h('p', { text: `You have unsaved edits on this device to ${cs.length === 1 ? 'a field' : `${cs.length} fields`} in ${file} that ${cs.length === 1 ? 'was' : 'were'} also changed on GitHub since. Your other edits are kept either way.` }), list],
        actions: [{ label: 'Use GitHub’s text', value: 'theirs', kind: 'ghost' }, { label: 'Keep my edits', value: 'mine', kind: 'primary' }],
        dismissable: false,
      });
      const v = await result;
      p.apply(v === 'mine');
      if (v === 'mine') toast('Kept your edits. Publishing will replace GitHub’s text for those fields.');
      return;
    }
    const { result } = openDialog({
      title: `${fileLabel(p.file)} changed on GitHub`, size: 'md',
      body: [
        h('p', {}, 'You have unpublished changes on this device that add, remove or reorder things in ', h('b', { text: file }), ', and that file was also changed on GitHub since, so they can’t be combined safely.'),
        h('ul', { class: 'opts' },
          h('li', {}, h('b', { text: 'Keep mine' }), ': your version stays; publishing it replaces GitHub’s version of this file.'),
          h('li', {}, h('b', { text: 'Use GitHub’s version' }), ': your unpublished changes to this file are dropped.')),
      ],
      actions: [{ label: 'Use GitHub’s version', value: 'theirs', kind: 'ghost' }, { label: 'Keep mine', value: 'mine', kind: 'primary' }],
      dismissable: false,
    });
    const v = await result;
    p.apply(v === 'mine');
    toast(v === 'mine' ? `Kept your version of ${file}. Review before publishing.` : `Loaded GitHub’s ${file}.`);
  }

  // ---------- painting ----------
  type Pill = { text: string; kind: 'idle' | 'local' | 'busy' | 'ok' | 'warn' | 'error'; href?: string; title?: string; action?: { label: string; run: () => void } };
  function pillState(): Pill {
    const n = st.count;
    if (busy) return { text: 'Publishing…', kind: 'busy' };
    if (failure) return { text: failure.msg, kind: 'error', title: failure.msg, action: { label: failure.label || 'Retry', run: failure.retry } };
    if (!token()) return { text: 'Preview only · connect to edit', kind: 'idle', title: 'Connect GitHub to edit and publish the site’s text' };
    if (loadingFiles) return { text: 'Loading the text from GitHub…', kind: 'busy' };
    if (pageFiles.some((f) => st.failed.has(f))) return { text: 'Couldn’t load this page’s text', kind: 'error', title: pageFiles.map((f) => st.failed.get(f)).filter(Boolean).join(' '), action: { label: 'Retry', run: retryLoad } };
    if (!st.localOk && n) return { text: 'Couldn’t save on this device', kind: 'error', title: 'Browser storage is full or blocked. Publish soon, or keep this tab open.' };
    if (n) return { text: `${n} unpublished ${n === 1 ? 'change' : 'changes'} · saved on this device`, kind: 'local', title: `Saved on this device${st.localAt ? ` (${fmtWhen(st.localAt)})` : ''}. Publish to put them on the site.`, action: { label: 'Review', run: reviewCmd } };
    if (deploy) {
      const url = liveUrl(deploy.page);
      if (deploy.state === 'failed') return { text: 'Deploy failed', kind: 'error', href: ACTIONS_URL, title: 'The site build failed. Open GitHub Actions for details.' };
      if (deploy.state === 'live') return { text: 'Live', kind: 'ok', href: url, title: `${SITE_HOST}${pageOf(deploy.page).path}` };
      if (deploy.state === 'unknown') return { text: 'Published · live in ~2 min', kind: 'ok', href: url, title: 'The site redeploys in about 2 minutes' };
      return { text: 'Published · live in ~2 min', kind: 'busy', title: 'The site is redeploying' };
    }
    return { text: 'No unpublished changes', kind: 'idle', title: 'Click any text on the page to edit it' };
  }
  let lastPill = '';
  function paintPill() {
    const p = pillState();
    const sig = JSON.stringify([p.text, p.kind, p.href, p.action?.label, p.title]);
    if (sig === lastPill) return;
    lastPill = sig;
    pill.dataset.kind = p.kind;
    pill.title = p.title || p.text;
    const kids: Node[] = [h('span', { class: 'dot', 'aria-hidden': 'true' })];
    if (p.href) kids.push(h('a', { class: 'st-text', href: p.href, target: '_blank', rel: 'noopener' }, p.text, h('span', { class: 'arr', 'aria-hidden': 'true', text: ' ↗' })));
    else kids.push(h('span', { class: 'st-text', text: p.text }));
    if (p.action) { const a = p.action; kids.push(h('button', { type: 'button', class: 'st-act', text: a.label, on: { click: () => a.run() } })); }
    pill.replaceChildren(...kids);
  }
  function paint() {
    if (!active) return;
    paintPill();
    const n = st.count;
    pubBtn.disabled = busy;
    pubBtn.dataset.tone = !token() ? 'off' : n ? 'hot' : 'calm';
    pubBtn.title = !token() ? 'Connect GitHub to publish' : n ? `Review and publish ${n} ${n === 1 ? 'change' : 'changes'}` : 'No changes to publish';
    undoBtn.disabled = !st.canUndo || busy;
    redoBtn.disabled = !st.canRedo || busy;
    undoBtn.title = st.canUndo ? `Undo ${st.undoLabel?.toLowerCase() || ''} (${keyLabel('Mod-z')})` : 'Nothing to undo';
    redoBtn.title = st.canRedo ? `Redo ${st.redoLabel?.toLowerCase() || ''} (${keyLabel('Shift-Mod-z')})` : 'Nothing to redo';
    detBtn.setAttribute('aria-pressed', String(inspector.isOpen));
    detBtn.disabled = !token();
    document.title = `${n ? '• ' : ''}Site · Write`;
    paintTabs();
  }
  function pageHasChanges(id: PageId) { return st.changes().some((c) => c.file === id); }
  function paintTabs() {
    tabs.querySelectorAll<HTMLButtonElement>('[data-page]').forEach((b) => {
      const id = b.dataset.page as PageId;
      b.setAttribute('aria-current', id === page ? 'page' : 'false');
      b.classList.toggle('has-ch', pageHasChanges(id));
    });
  }
  function paintNote() {
    const kids: Node[] = [];
    if (!token()) {
      kids.push(h('p', {}, h('b', { text: 'Edit your pages.' }), ' Connect GitHub once; changes are saved to the text files in the site’s repo when you publish.'),
        h('div', { class: 'note-btns' }, h('button', { type: 'button', class: 'btn btn-primary', text: 'Connect GitHub', on: { click: () => connect().then(onToken) } })));
    } else if (layer && !layer.fields().length) {
      kids.push(h('p', {}, h('b', { text: 'Nothing on this page can be edited yet.' }), ' Its text isn’t marked as editable in the site’s code.'));
    } else {
      const bad = pageFiles.filter((f) => st.failed.has(f));
      if (bad.length) kids.push(h('p', {}, h('b', { text: 'Couldn’t load this page’s text. ' }), bad.map((f) => st.failed.get(f)).join(' ')),
        h('div', { class: 'note-btns' }, h('button', { type: 'button', class: 'btn btn-ghost', text: 'Try again', on: { click: retryLoad } })));
    }
    note.replaceChildren(...kids);
    note.hidden = !kids.length;
  }
  function retryLoad() { st.retry(pageFiles); loadFiles(); }
  function onToken() { paint(); paintNote(); layer?.refresh(); items?.paint(); if (token()) loadFiles(); }
  window.addEventListener('bx-token', () => { if (active) onToken(); });
  const liveUrl = (id: PageId) => `https://${SITE_HOST}${pageOf(id).path}`;

  // ---------- deploy status ----------
  function stopDeploy() { deploySeq++; clearTimeout(deployTimer); deploy = null; }
  function startDeploy(afterIso: string, sha?: string) {
    stopDeploy();
    const my = deploySeq, started = Date.now();
    let fails = 0;
    deploy = { state: 'deploying', page };
    const tick = async () => {
      if (my !== deploySeq || !deploy) return;
      let s: Awaited<ReturnType<typeof deployStatus>>;
      try { s = await deployStatus(afterIso, sha); } catch { s = ++fails >= 3 ? 'unknown' : 'pending'; }
      if (my !== deploySeq || !deploy) return;
      if (s === 'live') { deploy.state = 'live'; announce('Your changes are live.'); }
      else if (s === 'failed') { deploy.state = 'failed'; announce('The site deploy failed.'); }
      else if (s === 'unknown' || Date.now() - started > 10 * 60e3) deploy.state = 'unknown';
      else deployTimer = window.setTimeout(tick, 10000);
      paint();
    };
    deployTimer = window.setTimeout(tick, 3000);
  }

  // ---------- publishing ----------
  async function publish(ctl?: { error(m: string | null): void }): Promise<boolean> {
    if (busy) return false;
    if (navigator.onLine === false) { const m = 'You’re offline. Your edits are safe on this device; publish once you’re back online.'; ctl ? ctl.error(m) : toast(m); return false; }
    if (!token()) { const ok = await connect({ reason: 'To publish, connect GitHub once. Your edits are safe on this device meanwhile.' }); onToken(); if (!ok) return false; }
    if (!st.count) return true;
    const iss = st.issues();
    if (iss.length) { const m = `Fix ${iss.length === 1 ? 'the problem' : `the ${iss.length} problems`} listed above first.`; ctl ? ctl.error(m) : reviewCmd(); return false; }
    st.flush();
    busy = true; failure = null; paint(); layer?.refresh();
    const afterIso = new Date().toISOString();
    try {
      const r = await st.publish();
      busy = false;
      if (r) startDeploy(r.commit.date || afterIso, r.commit.sha);
      announce('Published. The site updates in about 2 minutes.');
      toast('Published. The site updates in about 2 minutes.');
      layer?.refresh(); paint();
      return true;
    } catch (e) {
      busy = false;
      layer?.refresh();
      if (e instanceof st.PublishConflict) {
        const pc = e as InstanceType<typeof st.PublishConflict>;
        failure = { msg: 'Not published · newer version on GitHub', label: 'Resolve', retry: () => resolveConflict(pc) };
        paint();
        setTimeout(() => resolveConflict(pc), 0);
        return true; // close the review; the conflict dialog takes over
      }
      const msg = (e as Error).message || 'Couldn’t publish';
      const kind = (e as { kind?: string }).kind;
      failure = kind === 'auth' || kind === 'access'
        ? { msg: `Not published: ${msg}`, label: 'Reconnect', retry: () => connect().then((ok) => { onToken(); if (ok) { failure = null; publish(); } }) }
        : { msg: `Not published: ${msg}`, retry: () => { failure = null; publish(); } };
      announce(failure.msg);
      ctl?.error(msg);
      paint();
      return false;
    }
  }
  async function resolveConflict(e: InstanceType<typeof st.PublishConflict>) {
    if (document.querySelector('dialog[open]')) return;
    const file = `${e.file}.json`;
    if (!e.fresh) {
      const ok = await confirmDialog({ title: `${file} is gone`, message: `${file} was deleted or moved on GitHub, so your edits to it can’t be published. Discard them?`, confirm: 'Discard my edits to it', cancel: 'Keep them for now', danger: true });
      if (ok) { st.discardFile(e.file); failure = null; paint(); }
      return;
    }
    const rows = e.conflicts.length ? h('ul', { class: 'rv-rows rv-compact' }, ...e.conflicts.slice(0, 6).map((c) => h('li', { class: 'rv-row' },
      h('div', { class: 'rv-top' }, h('span', { class: 'rv-key', text: crumbs(c.file, c.ptr, st.get(`${c.file}:`)).join(' › ') })),
      h('p', { class: 'rv-v rv-old' }, h('span', { class: 'rv-tag', text: 'GitHub ' }), fmtVal(c.theirs)),
      h('p', { class: 'rv-v rv-new' }, h('span', { class: 'rv-tag', text: 'Yours ' }), fmtVal(c.mine))))) : null;
    const { result } = openDialog({
      title: `${fileLabel(e.file)} changed on GitHub`,
      size: 'md',
      body: [
        h('p', {}, 'Someone (maybe you, on GitHub or another device) saved a newer ', h('b', { text: file }), e.structural
          ? ' after you started editing, and your changes add, remove or reorder things, so the two can’t be combined safely. Nothing was published from this file.'
          : ` after you started editing, and changed ${e.conflicts.length === 1 ? 'a field you edited' : `${e.conflicts.length} fields you edited`}. Nothing was published from this file.`),
        ...(rows ? [rows] : []),
        h('ul', { class: 'opts' },
          h('li', {}, h('b', { text: 'Reload GitHub’s version' }), e.structural ? ': your unpublished changes to this file are dropped.' : ': those fields take the newer text; your other edits stay.'),
          h('li', {}, h('b', { text: 'Publish mine anyway' }), e.structural ? ': your version of the file replaces GitHub’s.' : ': your text replaces the newer text in those fields.')),
      ],
      actions: [
        { label: 'Cancel', value: 'cancel', kind: 'quiet' },
        { label: 'Reload GitHub’s version', value: 'load', kind: 'ghost' },
        { label: 'Publish mine anyway', value: 'mine', kind: 'danger' },
      ],
      focus: '.btn-quiet',
    });
    const v = await result;
    if (v === 'load') { e.resolve(false); failure = null; paint(); toast(st.count ? 'Loaded the newer version. Your other edits are still here.' : 'Loaded the newer version.'); }
    else if (v === 'mine') { e.resolve(true); failure = null; await publish(); }
  }

  // ---------- commands ----------
  async function reviewCmd() {
    if (document.querySelector('dialog[open]')) return;
    if (!token()) { const ok = await connect({ reason: 'To edit and publish the site, connect GitHub once.' }); onToken(); if (!ok) return; }
    layer?.blur();
    st.flush();
    review = openReview({
      changes: () => st.changes(),
      issues: () => st.issues(),
      data: (f) => st.get(`${f}:`),
      imgSrc: (p) => images.src(p),
      revert: (c: Change) => st.revert(c),
      discardFile: (f) => st.discardFile(f),
      show: (k) => showKey(k),
      discardAll: discardCmd,
      publish: (ctl) => publish(ctl),
      connected: () => !!token(),
    });
    review.result.finally(() => { review = null; });
  }
  /** Go to a field or item: its page, the text in the page, or its row in Details. */
  async function showKey(k: Key) {
    const p = parseKey(k);
    if (!p) return;
    const target = (PAGES.find((x) => x.id === p.file)?.id) || page;
    if (target !== page) await load(target), await new Promise((r) => setTimeout(r, 50));
    // the nearest item holding k
    const t = tokens(p.ptr);
    let item: Key | null = null;
    for (let n = t.length; n > 0; n--) if (isIndex(t[n - 1]) && listAt(p.file, join('', ...t.slice(0, n - 1)))) { item = keyOf(p.file, join('', ...t.slice(0, n))); break; }
    const isText = !!doc()?.querySelector(`[data-edit="${CSS.escape(k)}"][contenteditable]`);
    if (isText && layer?.focusKey(k)) { if (item) select(item); return; }
    inspector.open(item, k);
    if (item) items?.scrollTo(item);
  }
  async function discardCmd(): Promise<boolean> {
    const n = st.count;
    if (!n) return true;
    const ok = await confirmDialog({ title: `Discard ${n} ${n === 1 ? 'change' : 'changes'}?`, message: 'The pages go back to what’s on GitHub. You can still undo this until you leave.', confirm: 'Discard changes', cancel: 'Keep them', danger: true });
    if (ok) { st.discardAll(); failure = null; toast('Changes discarded.', { action: { label: 'Undo', run: undoCmd } }); }
    return ok;
  }
  function afterHistory(e: { label: string; files: Record<string, unknown> } | null, word: string) {
    if (!e) { toast(`Nothing to ${word.toLowerCase()}.`, { ms: 1600 }); return; }
    layer?.refocusSession();
    const elsewhere = Object.keys(e.files).filter((f) => f !== 'site' && !pageFiles.includes(f));
    const msg = `${word === 'Undo' ? 'Undid' : 'Redid'}: ${e.label.toLowerCase()}${elsewhere.length ? ` (on ${elsewhere.map(fileLabel).join(', ')})` : ''}`;
    announce(msg);
    if (elsewhere.length) toast(msg, { ms: 2400 });
  }
  function undoCmd() { afterHistory(st.undo(), 'Undo'); }
  function redoCmd() { afterHistory(st.redo(), 'Redo'); }
  function setPhone(on: boolean) { stage.classList.toggle('is-phone', on); store.set(PHONE_KEY, on ? '1' : '0'); setTimeout(() => items?.paint(), 50); }
  setPhone(store.get(PHONE_KEY) === '1');

  tabs.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('[data-page]');
    if (!b || b.dataset.page === page) return;
    load(b.dataset.page as PageId);
  });
  pubBtn.addEventListener('click', reviewCmd);
  undoBtn.addEventListener('click', undoCmd);
  redoBtn.addEventListener('click', redoCmd);
  detBtn.addEventListener('click', () => { inspector.toggle(); paint(); });
  const narrow = matchMedia('(max-width: 640px)');
  attachMenu(moreBtn, () => {
    const n = st.count;
    const items0: (MenuItem | null)[] = [
      { label: 'Review changes…', hint: keyLabel('Mod-s'), run: reviewCmd, note: n ? `${n} unpublished` : 'No changes yet' },
      narrow.matches ? { label: 'Undo', hint: keyLabel('Mod-z'), run: undoCmd, disabled: !st.canUndo } : null,
      narrow.matches ? { label: 'Redo', hint: keyLabel('Shift-Mod-z'), run: redoCmd, disabled: !st.canRedo } : null,
      { label: 'Page details…', run: () => { inspector.open(null); paint(); } },
      { label: 'Discard all changes…', run: () => { discardCmd(); }, disabled: !n, danger: true },
      { sep: true },
      !narrow.matches ? { label: 'Phone-width preview', checked: stage.classList.contains('is-phone'), run: () => setPhone(!stage.classList.contains('is-phone')) } : null,
      { label: 'Open the live page', run: () => window.open(liveUrl(page), '_blank', 'noopener'), note: `${SITE_HOST}${pageOf(page).path}` },
      { sep: true },
      { label: 'GitHub connection', note: token() ? 'Connected' : 'Not connected', run: () => connect().then(onToken) },
    ];
    return (items0.filter(Boolean) as MenuItem[]).filter((it, i, a) => !('sep' in it) || (i > 0 && !('sep' in a[i - 1]) && i < a.length - 1));
  });
  { const m = moreBtn.nextElementSibling as HTMLElement | null; if (m?.classList.contains('menu')) { m.id = 'site-menu'; m.setAttribute('aria-label', 'Site actions'); moreBtn.setAttribute('aria-controls', m.id); } }

  function globalKeys(e: KeyboardEvent) {
    if (!active) return;
    const mod = e.metaKey || e.ctrlKey;
    if (!mod || e.altKey) return;
    const k = e.key.toLowerCase();
    const modal = !!document.querySelector('dialog[open]');
    if (k === 's' && !e.shiftKey) { e.preventDefault(); if (!modal) reviewCmd(); }
    else if ((k === 'z' || (k === 'y' && !e.shiftKey)) && !modal) {
      // one history for everything, also while typing in the Details panel
      e.preventDefault();
      if (k === 'y' || e.shiftKey) redoCmd(); else undoCmd();
    }
  }
  window.addEventListener('keydown', globalKeys);
  const flush = () => st.flush();
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

  return {
    enter() {
      active = true;
      lastPill = '';
      if (!frame.getAttribute('src')) load(page);
      paint(); paintNote();
      hint.hidden = false;
    },
    leave() {
      active = false;
      st.flush();
      layer?.blur();
      inspector.close();
    },
  };
}
