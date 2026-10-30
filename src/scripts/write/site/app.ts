// Site mode of /write: edit the text of Home, Experience and Contact in place. The real
// page loads in a same-origin iframe; layer.ts makes its [data-edit] text editable;
// state.ts tracks edits per JSON file, autosaves them on this device and publishes them.
import { $, OWNER, REPO, store } from '../lib';
import { token, deployStatus } from '../github';
import { h } from '../ui/dom';
import { openDialog, confirmDialog } from '../ui/dialog';
import { toast, announce } from '../ui/toast';
import { connect } from '../ui/connect';
import { attachMenu, type MenuItem } from '../ui/menu';
import { fmtWhen, SITE_HOST } from '../ui/format';
import { keyLabel } from '../editor/ui';
import { attachLayer, type Layer, type FieldInfo } from './layer';
import { createSiteState, type Conflict } from './state';
import { openReview } from './review';
import { parseKey, prettyKey, FILE_RE, type Key } from './pointer';

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

export function startSite() {
  // ---------- elements ----------
  const pill = $('.ss-state');
  const pubBtn = $<HTMLButtonElement>('[data-act="site-publish"]');
  const moreBtn = $<HTMLButtonElement>('[data-act="site-more"]');
  const tabs = $('.spages');
  const note = $('.s-note');
  const stage = $('.s-stage');
  const frame = $<HTMLIFrameElement>('.s-frame');
  const hint = $('.s-hint');

  // ---------- state ----------
  let page: PageId = (PAGES.find((p) => p.id === store.get(PAGE_KEY))?.id) || 'home';
  let layer: Layer | null = null;
  let active = false;
  let loadingFiles = false;
  let pageFiles: string[] = [];
  let busy = false;
  let failure: { msg: string; label?: string; retry: () => void } | null = null;
  let deploy: { state: 'deploying' | 'live' | 'failed' | 'unknown'; page: PageId } | null = null;
  let deployTimer = 0, deploySeq = 0;
  let review: ReturnType<typeof openReview> | null = null;
  let attached: (() => void) | null = null;
  const info = new Map<Key, FieldInfo>();
  const seenOn = new Map<Key, Set<PageId>>();

  const st = createSiteState((keys) => {
    if (keys && layer) layer.update(keys);
    paint();
    review?.paint();
  });

  const host = {
    value: (k: Key) => st.value(k),
    loaded: (k: Key) => { const p = parseKey(k); return !!p && (st.files.has(p.file) || st.failed.has(p.file)); },
    changed: (k: Key) => st.changed(k),
    set: (k: Key, v: string) => st.set(k, v),
    beginEdit: (k: Key) => st.beginEdit(k),
    endEdit: () => st.endEdit(),
    editable: () => !!token() && !busy,
    command: (c: 'save' | 'undo') => (c === 'save' ? reviewCmd() : undoCmd()),
    message: (m: string) => toast(m, { ms: 2600 }),
  };

  // ---------- the iframe ----------
  const pageOf = (id: PageId) => PAGES.find((p) => p.id === id)!;
  function load(id: PageId): Promise<void> {
    page = id;
    store.set(PAGE_KEY, id);
    layer?.destroy(); layer = null;
    paintTabs();
    note.hidden = true;
    stage.classList.add('is-loading');
    const done = new Promise<void>((r) => (attached = r));
    frame.src = pageOf(id).path;
    return done;
  }
  frame.addEventListener('load', async () => {
    const win = frame.contentWindow;
    let doc: Document | null = null;
    try { doc = win?.document ?? null; } catch {}
    const want = pageOf(page);
    if (!win || !doc || trim(win.location.pathname) !== trim(want.path)) {
      // the page went somewhere else (a link we didn't catch, a redirect): back to the page being edited
      if (win && doc) { toast('That link would leave the page, so it stays here while you edit.'); frame.src = want.path; }
      return;
    }
    layer?.destroy();
    layer = attachLayer(win, host);
    const fs = layer.fields();
    for (const f of fs) {
      info.set(f.key, f);
      (seenOn.get(f.key) || seenOn.set(f.key, new Set()).get(f.key)!).add(page);
    }
    pageFiles = [...new Set(fs.map((f) => parseKey(f.key)!.file))].filter((n) => FILE_RE.test(n));
    stage.classList.remove('is-loading');
    attached?.(); attached = null;
    paintNote();
    await loadFiles();
  });
  async function loadFiles() {
    if (!token()) { paint(); paintNote(); return; }
    loadingFiles = true; paint();
    const conflicts = await st.ensure([...pageFiles, ...st.orphaned()]);
    loadingFiles = false;
    layer?.refresh();
    paint(); paintNote(); paintTabs();
    if (conflicts.length) await askRestore(conflicts);
  }
  async function askRestore(cs: Conflict[]) {
    const list = h('ul', { class: 'rv-rows rv-compact' }, ...cs.slice(0, 6).map((c) => h('li', { class: 'rv-row' },
      h('div', { class: 'rv-top' }, h('span', { class: 'rv-key', text: prettyKey(`${c.file}:${c.ptr}`) })),
      h('p', { class: 'rv-v rv-old' }, h('span', { class: 'rv-tag', text: 'GitHub ' }), c.theirs || '(empty)'),
      h('p', { class: 'rv-v rv-new' }, h('span', { class: 'rv-tag', text: 'Yours ' }), c.mine || '(empty)'))));
    const { result } = openDialog({
      title: 'Some text changed on GitHub',
      size: 'md',
      body: [h('p', { text: `You have unsaved edits on this device to ${cs.length === 1 ? 'a field' : `${cs.length} fields`} that ${cs.length === 1 ? 'was' : 'were'} also changed on GitHub since. Your other edits are kept either way.` }), list],
      actions: [{ label: 'Use GitHub’s text', value: 'theirs', kind: 'ghost' }, { label: 'Keep my edits', value: 'mine', kind: 'primary' }],
      dismissable: false,
    });
    const v = await result;
    st.settle(cs, v === 'mine');
    if (v === 'mine') toast('Kept your edits. Publishing will replace GitHub’s text for those fields.');
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
    document.title = `${n ? '• ' : ''}Site · Write`;
    paintTabs();
  }
  function pageHasChanges(id: PageId) {
    return st.changes().some((c) => c.file === id); // site.json edits show on every page, so they mark none
  }
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
      kids.push(h('p', {}, h('b', { text: 'Edit the text on your pages.' }), ' Connect GitHub once; changes are saved to the text files in the site’s repo when you publish.'),
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
  function onToken() { paint(); paintNote(); layer?.refresh(); if (token()) loadFiles(); }
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
        failure = { msg: 'Not published · newer text on GitHub', label: 'Resolve', retry: () => resolveConflict(e as InstanceType<typeof st.PublishConflict>) };
        paint();
        setTimeout(() => resolveConflict(e as InstanceType<typeof st.PublishConflict>), 0);
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
      if (ok) { for (const c of st.changes()) if (c.file === e.file) st.revert(c.key); failure = null; paint(); }
      return;
    }
    const rows = h('ul', { class: 'rv-rows rv-compact' }, ...e.fields.slice(0, 6).map((c) => h('li', { class: 'rv-row' },
      h('div', { class: 'rv-top' }, h('span', { class: 'rv-key', text: prettyKey(`${c.file}:${c.ptr}`) })),
      h('p', { class: 'rv-v rv-old' }, h('span', { class: 'rv-tag', text: 'GitHub ' }), c.theirs || '(empty)'),
      h('p', { class: 'rv-v rv-new' }, h('span', { class: 'rv-tag', text: 'Yours ' }), c.mine || '(empty)'))));
    const { result } = openDialog({
      title: 'This text changed on GitHub',
      size: 'md',
      body: [
        h('p', {}, 'Someone (maybe you, on GitHub or another device) saved a newer ', h('b', { text: file }), ` after you started editing, and changed ${e.fields.length === 1 ? 'a field you edited' : `${e.fields.length} fields you edited`}. Nothing was published from this file.`),
        rows,
        h('ul', { class: 'opts' },
          h('li', {}, h('b', { text: 'Reload GitHub’s text' }), ': those fields take the newer text; your other edits stay.'),
          h('li', {}, h('b', { text: 'Publish mine anyway' }), ': your text replaces the newer text in those fields.')),
      ],
      actions: [
        { label: 'Cancel', value: 'cancel', kind: 'quiet' },
        { label: 'Reload GitHub’s text', value: 'load', kind: 'ghost' },
        { label: 'Publish mine anyway', value: 'mine', kind: 'danger' },
      ],
      focus: '.btn-quiet',
    });
    const v = await result;
    if (v === 'load') { st.rebase(e.file, e.fresh, false); failure = null; paint(); toast(st.count ? 'Loaded the newer text. Your other edits are still here.' : 'Loaded the newer text.'); }
    else if (v === 'mine') { st.rebase(e.file, e.fresh, true); failure = null; await publish(); }
  }

  // ---------- commands ----------
  async function reviewCmd() {
    if (document.querySelector('dialog[open]')) return;
    if (!token()) { const ok = await connect({ reason: 'To edit and publish the site’s text, connect GitHub once.' }); onToken(); if (!ok) return; }
    layer?.blur();
    st.flush();
    review = openReview({
      changes: () => st.changes(),
      info: (k) => info.get(k),
      revert: (k) => st.revert(k),
      show: (k) => showKey(k),
      discardAll: discardCmd,
      publish: (ctl) => publish(ctl),
      connected: () => !!token(),
    });
    review.result.finally(() => { review = null; });
  }
  async function showKey(k: Key) {
    const pages = seenOn.get(k);
    const p = parseKey(k)?.file as PageId | undefined;
    const target: PageId | undefined = pages?.has(page) ? page : pages ? [...pages][0] : PAGES.find((x) => x.id === p)?.id;
    if (target && target !== page) await load(target);
    if (!layer?.focusKey(k)) toast('That text isn’t on this page.');
  }
  async function discardCmd(): Promise<boolean> {
    const n = st.count;
    if (!n) return true;
    const ok = await confirmDialog({ title: `Discard ${n} ${n === 1 ? 'change' : 'changes'}?`, message: 'The page goes back to the text that’s on GitHub. This can’t be undone.', confirm: 'Discard changes', cancel: 'Keep them', danger: true });
    if (ok) { st.discardAll(); failure = null; toast('Changes discarded.'); }
    return ok;
  }
  function undoCmd() {
    const k = st.undo();
    if (!k) { toast('Nothing to undo.', { ms: 1600 }); return; }
    layer?.update([k]);
    layer?.refocusSession();
    const pages = seenOn.get(k);
    if (pages && !pages.has(page)) toast(`Undid a change on ${pageOf([...pages][0]).label}.`, { ms: 2200 });
  }
  function setPhone(on: boolean) { stage.classList.toggle('is-phone', on); store.set(PHONE_KEY, on ? '1' : '0'); }
  setPhone(store.get(PHONE_KEY) === '1');

  tabs.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('[data-page]');
    if (!b || b.dataset.page === page) return;
    load(b.dataset.page as PageId);
  });
  pubBtn.addEventListener('click', reviewCmd);
  const narrow = matchMedia('(max-width: 640px)');
  attachMenu(moreBtn, () => {
    const n = st.count;
    const items: (MenuItem | null)[] = [
      { label: 'Review changes…', hint: keyLabel('Mod-s'), run: reviewCmd, note: n ? `${n} unpublished` : 'No changes yet' },
      { label: 'Undo last edit', hint: keyLabel('Mod-z'), run: undoCmd, disabled: !st.canUndo },
      { label: 'Discard all changes…', run: () => { discardCmd(); }, disabled: !n, danger: true },
      { sep: true },
      !narrow.matches ? { label: 'Phone-width preview', checked: stage.classList.contains('is-phone'), run: () => setPhone(!stage.classList.contains('is-phone')) } : null,
      { label: 'Open the live page', run: () => window.open(liveUrl(page), '_blank', 'noopener'), note: `${SITE_HOST}${pageOf(page).path}` },
      { sep: true },
      { label: 'GitHub connection', note: token() ? 'Connected' : 'Not connected', run: () => connect().then(onToken) },
    ];
    return (items.filter(Boolean) as MenuItem[]).filter((it, i, a) => !('sep' in it) || (i > 0 && !('sep' in a[i - 1]) && i < a.length - 1));
  });
  // the shared attachMenu names its menu 'more-menu'; give this one its own id
  { const m = moreBtn.nextElementSibling as HTMLElement | null; if (m?.classList.contains('menu')) { m.id = 'site-menu'; m.setAttribute('aria-label', 'Site actions'); moreBtn.setAttribute('aria-controls', m.id); } }

  function globalKeys(e: KeyboardEvent) {
    if (!active) return;
    const mod = e.metaKey || e.ctrlKey;
    if (!mod || e.altKey) return;
    const k = e.key.toLowerCase();
    const modal = !!document.querySelector('dialog[open]');
    const typing = /^(INPUT|TEXTAREA)$/.test((document.activeElement as HTMLElement | null)?.tagName || '');
    if (k === 's' && !e.shiftKey) { e.preventDefault(); if (!modal) reviewCmd(); }
    else if (k === 'z' && !e.shiftKey && !modal && !typing && e.currentTarget === window) { e.preventDefault(); undoCmd(); }
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
    },
  };
}
