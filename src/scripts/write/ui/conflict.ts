// Shown when GitHub has a newer copy of the post than the one these edits are based on.
import { h } from './dom';
import { openDialog } from './dialog';

/** Resolves 'load' (discard mine), 'overwrite' (force save mine), or null (cancel). */
export function conflictDialog(o: { title: string; download: () => void }): Promise<string | null> {
  const dl = h('button', { type: 'button', class: 'linkish', text: 'Download my version as .md' });
  dl.addEventListener('click', o.download);
  return openDialog({
    title: 'This post changed somewhere else',
    size: 'md',
    body: [
      h('p', {}, 'Someone (maybe you, on GitHub or another device) saved a newer version of ', h('b', { text: `“${o.title.trim() || 'Untitled'}”` }), ' after you started editing here. Choose which version to keep.'),
      h('ul', { class: 'opts' },
        h('li', {}, h('b', { text: 'Load the newer version' }), ': replaces what’s in the editor. Your edits here are discarded.'),
        h('li', {}, h('b', { text: 'Overwrite with mine' }), ': saves your edits over the newer version.'),
      ),
      h('p', { class: 'fine' }, 'Not sure? ', dl, ' first, so nothing is lost.'),
    ],
    actions: [
      { label: 'Cancel', value: 'cancel', kind: 'quiet' },
      { label: 'Load the newer version', value: 'load', kind: 'ghost' },
      { label: 'Overwrite with mine', value: 'overwrite', kind: 'danger' },
    ],
    focus: '.btn-quiet',
  }).result.then((v) => (v === 'cancel' ? null : v));
}
