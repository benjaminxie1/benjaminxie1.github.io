// Version history: commits for a post, read-only preview, restore as unsaved changes.
import { postHistory, loadPostAt } from '../github';
import type { Doc } from '../lib';
import { h } from './dom';
import { openDialog } from './dialog';
import { relDate, fmtDate } from './format';

export function openHistory(path: string, restore: (d: Doc) => void) {
  const list = h('ul', { class: 'hlist', 'aria-label': 'Versions' });
  const pane = h('div', { class: 'hpane', 'aria-live': 'polite' }, h('p', { class: 'pnote', text: 'Pick a version to see it here.' }));
  let picked: Doc | null = null;
  let seq = 0;

  const { ctl } = openDialog({
    title: 'Version history',
    description: 'Every save to GitHub is a version. Restoring puts that version in the editor as unsaved changes; nothing changes on the site until you save or update.',
    size: 'lg',
    className: 'history',
    body: [h('div', { class: 'hgrid' }, list, pane)],
    actions: [
      { label: 'Close', value: 'close', kind: 'ghost' },
      { label: 'Restore this version', value: 'restore', kind: 'primary', disabled: true, run: () => { if (picked) restore(picked); } },
    ],
  });

  const show = async (c: { commit: string; date: string; message: string }, btn: HTMLButtonElement) => {
    list.querySelectorAll('button').forEach((b) => b.setAttribute('aria-current', String(b === btn)));
    const my = ++seq;
    picked = null;
    ctl.buttons.restore.disabled = true;
    pane.replaceChildren(h('p', { class: 'pnote', text: 'Loading this version…' }));
    try {
      const d = await loadPostAt(path, c.commit);
      if (my !== seq) return;
      picked = d;
      ctl.buttons.restore.disabled = false;
      const body = h('div', { class: 'body' });
      body.innerHTML = d.html; // repo content, read-only preview
      body.querySelectorAll('img').forEach((img) => img.setAttribute('loading', 'lazy'));
      pane.replaceChildren(h('div', { class: 'post hpost' },
        h('p', { class: 'hmeta', text: `${c.message} · ${relDate(c.date, true)}` }),
        h('h1', { class: 'htitle', text: d.title || 'Untitled' }),
        d.description ? h('p', { class: 'dek', text: d.description }) : null,
        h('p', { class: 'published', text: (d.draft ? 'Draft · ' : 'Published ') + fmtDate(d.date) }),
        body,
      ));
    } catch (e) {
      if (my !== seq) return;
      pane.replaceChildren(h('p', { class: 'pnote bad', text: (e as Error).message || 'Couldn’t load this version' }));
    }
  };

  list.append(h('li', { class: 'pnote', text: 'Loading history…' }));
  postHistory(path).then((items) => {
    list.replaceChildren();
    if (!items.length) list.append(h('li', { class: 'pnote', text: 'No saved versions yet.' }));
    items.forEach((c, i) => {
      const b = h('button', { type: 'button', class: 'hitem' },
        h('span', { class: 'hwhen', text: relDate(c.date, true) + (i === 0 ? ' · current' : '') }),
        h('span', { class: 'hmsg', text: c.message.split('\n')[0] }),
      );
      b.addEventListener('click', () => show(c, b));
      list.append(h('li', {}, b));
    });
  }).catch((e) => {
    list.replaceChildren(h('li', { class: 'pnote bad', text: (e as Error).message || 'Couldn’t load history' }));
  });
}
