// Posts panel: search, All / Drafts / Published, local-unsaved markers,
// local-only new posts, open, new post, delete.
import { listPosts, token } from '../github';
import { listLocal } from '../local';
import { h, icon } from './dom';
import { openDialog } from './dialog';
import { relDate } from './format';

export type PostRow = {
  key: string;
  path: string | null;
  sha: string | null;
  title: string;
  date: string;
  description: string;
  draft: boolean;
  inRepo: boolean;
  localDirty: boolean;
  error?: string;
};
export type PostsHost = {
  currentKey(): string;
  open(row: PostRow): Promise<boolean>;
  newPost(): void;
  remove(row: PostRow): Promise<boolean>;
  connect(): Promise<boolean>;
};

type Tab = 'all' | 'drafts' | 'published';
let lastTab: Tab = 'all';

function localRows(): PostRow[] {
  return listLocal().map((e) => ({
    key: e.key,
    path: e.doc.path,
    sha: e.doc.sha,
    title: e.doc.title,
    date: e.doc.date,
    description: e.doc.description,
    draft: !e.doc.published,
    inRepo: !!e.doc.path,
    localDirty: e.dirty,
  }));
}

export function openPosts(host: PostsHost) {
  let rows: PostRow[] = [];
  let tab: Tab = lastTab;
  let q = '';
  let state: 'loading' | 'ready' | 'error' | 'offline' = token() ? 'loading' : 'offline';
  let errMsg = '';

  const search = h('input', { class: 'field search', type: 'search', placeholder: 'Search posts', 'aria-label': 'Search posts' });
  const tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Filter posts' });
  const list = h('ul', { class: 'plist', 'aria-live': 'polite' });
  const tabBtns = (['all', 'drafts', 'published'] as Tab[]).map((t) => {
    const b = h('button', { type: 'button', role: 'tab', class: 'tab', 'data-tab': t, text: t === 'all' ? 'All' : t === 'drafts' ? 'Drafts' : 'Published' });
    b.addEventListener('click', () => { tab = lastTab = t; paint(); });
    tabs.append(b);
    return b;
  });
  search.addEventListener('input', () => { q = search.value.toLowerCase().trim(); paint(); });

  const newBtn = h('button', { type: 'button', class: 'btn btn-primary new-post' }, icon('plus', 16), 'New post');
  newBtn.addEventListener('click', () => { ctl.close('new'); host.newPost(); });

  const { ctl } = openDialog({
    title: 'Posts', size: 'side', className: 'posts-panel',
    body: [h('div', { class: 'ptop' }, search, newBtn), tabs, list],
    focus: search,
  });

  function merge(remote: Awaited<ReturnType<typeof listPosts>>) {
    const local = localRows();
    const byPath = new Map(local.filter((r) => r.path).map((r) => [r.path!, r]));
    const out: PostRow[] = remote.map((p) => {
      const l = byPath.get(p.path);
      return { key: p.path, path: p.path, sha: p.sha, title: p.title, date: p.date, description: p.description, draft: p.draft, inRepo: true, localDirty: !!l?.localDirty, error: (p as { error?: string }).error };
    });
    const seen = new Set(out.map((r) => r.key));
    for (const l of local) {
      if (seen.has(l.key)) continue;
      // local-only new posts (never saved) and anything we can't see remotely
      if (!l.path && !l.title.trim() && !l.localDirty) continue;
      if (l.path && state === 'ready') continue; // gone from the repo (deleted elsewhere)
      out.push(l);
    }
    return out;
  }

  async function load() {
    if (!token()) { state = 'offline'; rows = merge([]); return paint(); }
    state = 'loading'; paint();
    try {
      const remote = await listPosts();
      state = 'ready';
      rows = merge(remote);
    } catch (e) {
      state = 'error'; errMsg = (e as Error).message;
      rows = merge([]);
    }
    paint();
  }

  function paint() {
    tabBtns.forEach((b) => { const on = b.dataset.tab === tab; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
    list.replaceChildren();
    if (state === 'loading') {
      for (let i = 0; i < 3; i++) list.append(h('li', { class: 'prow skeleton', 'aria-hidden': 'true' }, h('span'), h('span')));
      list.setAttribute('aria-busy', 'true');
      return;
    }
    list.removeAttribute('aria-busy');
    if (state === 'offline') list.append(h('li', { class: 'pnote' }, 'Showing posts on this device. ', h('button', { type: 'button', class: 'linkish', text: 'Connect GitHub', on: { click: async () => { if (await host.connect()) load(); } } }), ' to see everything on the site.'));
    if (state === 'error') list.append(h('li', { class: 'pnote bad' }, `Couldn’t load posts from GitHub: ${errMsg} `, h('button', { type: 'button', class: 'linkish', text: 'Try again', on: { click: load } })));
    const shown = rows
      .filter((r) => (tab === 'all' ? true : tab === 'drafts' ? r.draft : !r.draft))
      .filter((r) => !q || (r.title + ' ' + r.description).toLowerCase().includes(q))
      .sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
    if (!shown.length && (state === 'ready' || state === 'offline' || state === 'error')) {
      list.append(h('li', { class: 'pnote', text: q ? 'No posts match your search.' : tab === 'published' ? 'Nothing published yet.' : tab === 'drafts' ? 'No drafts.' : 'No posts yet. Start one with New post.' }));
    }
    const cur = host.currentKey();
    for (const r of shown) {
      const badges = h('span', { class: 'badges' },
        h('span', { class: 'badge ' + (r.draft ? 'b-draft' : 'b-pub'), text: r.draft ? 'Draft' : 'Published' }),
        !r.inRepo ? h('span', { class: 'badge b-local', text: 'Only on this device' }) : null,
        r.inRepo && r.localDirty ? h('span', { class: 'badge b-local', text: 'Unsaved edits on this device' }) : null,
        r.error ? h('span', { class: 'badge b-warn', text: 'Can’t read this file', title: r.error }) : null,
        r.key === cur ? h('span', { class: 'badge b-cur', text: 'Open now' }) : null,
      );
      const openBtn = h('button', { type: 'button', class: 'prow-open' },
        h('span', { class: 'ptitle', text: r.title.trim() || 'Untitled' }),
        h('span', { class: 'pmeta' }, h('span', { class: 'pdate', text: relDate(r.date) }), badges),
      );
      openBtn.addEventListener('click', async () => {
        openBtn.classList.add('opening');
        openBtn.setAttribute('aria-busy', 'true');
        const ok = await host.open(r).catch(() => false);
        if (ok) ctl.close('open');
        else { openBtn.classList.remove('opening'); openBtn.removeAttribute('aria-busy'); }
      });
      const del = h('button', { type: 'button', class: 'prow-del', text: 'Delete', 'aria-label': `Delete “${r.title.trim() || 'Untitled'}”` });
      del.addEventListener('click', async () => { if (await host.remove(r)) { rows = rows.filter((x) => x.key !== r.key); paint(); } });
      list.append(h('li', { class: 'prow' + (r.key === cur ? ' current' : '') }, openBtn, del));
    }
  }

  tabs.addEventListener('keydown', (e) => {
    const i = tabBtns.findIndex((b) => b.dataset.tab === tab);
    const n = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!n) return;
    const next = tabBtns[(i + n + 3) % 3];
    tab = lastTab = next.dataset.tab as Tab; paint(); next.focus();
  });

  load();
}
