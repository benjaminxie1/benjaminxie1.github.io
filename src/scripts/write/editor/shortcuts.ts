// The shortcut sheet (⌘/): a calm native <dialog>.
import { h, icons, keyLabel } from './ui';

const KEYS: Array<[string, string]> = [
  ['Mod-b', 'Bold'],
  ['Mod-i', 'Italic'],
  ['Mod-Shift-s', 'Strikethrough'],
  ['Mod-e', 'Inline code'],
  ['Mod-k', 'Add or edit link'],
  ['Mod-Alt-2', 'Heading'],
  ['Mod-Alt-3', 'Subheading'],
  ['Mod-Alt-0', 'Normal text'],
  ['Mod-Shift-b', 'Quote'],
  ['Mod-Shift-8', 'Bulleted list'],
  ['Mod-Shift-7', 'Numbered list'],
  ['Mod-Alt-c', 'Code block'],
  ['Mod-Alt-f', 'Footnote / citation'],
  ['Shift-Enter', 'Line break'],
  ['Mod-z', 'Undo'],
  ['Mod-Shift-z', 'Redo'],
  ['Mod-/', 'This sheet'],
  ['Alt-F10', 'Jump to the format menu'],
];
const MD: Array<[string, string]> = [
  ['/', 'Insert menu'],
  ['## ', 'Heading'],
  ['### ', 'Subheading'],
  ['> ', 'Quote'],
  ['- ', 'Bulleted list'],
  ['1. ', 'Numbered list'],
  ['```', 'Code block'],
  ['---', 'Divider'],
  ['**bold**', 'Bold'],
  ['*italic*', 'Italic'],
  ['~~strike~~', 'Strikethrough'],
  ['`code`', 'Inline code'],
];

let dialog: HTMLDialogElement | null = null;
let returnTo: (() => void) | null = null;

function build() {
  const row = (k: Node | string, label: string) => h('li', {}, h('span', { class: 'ed-sc-label' }, label), typeof k === 'string' ? h('kbd', {}, k) : k);
  const keys = KEYS.map(([k, l]) => {
    const wrap = h('span', { class: 'ed-sc-keys' });
    wrap.append(h('kbd', {}, keyLabel(k)));
    return row(wrap, l);
  });
  const md = MD.map(([k, l]) => row(h('code', {}, k.replace(/ $/, '␣')), l));
  const close = h('button', { type: 'button', class: 'ed-btn ed-icon-only ed-sc-close', 'aria-label': 'Close', html: icons.close });
  const d = h('dialog', { class: 'ed-sheet', 'aria-labelledby': 'ed-sc-title', autofocus: true, tabindex: '-1' },
    h('header', {}, h('h2', { id: 'ed-sc-title' }, 'Shortcuts'), close),
    h('p', { class: 'ed-sc-intro' }, 'Select text to format it, or type / on a new line to add a block. Markdown works as you type.'),
    h('div', { class: 'ed-sc-cols' },
      h('section', {}, h('h3', {}, 'Keyboard'), h('ul', {}, ...keys)),
      h('section', {}, h('h3', {}, 'As you type'), h('ul', {}, ...md)),
    ),
  ) as HTMLDialogElement;
  close.addEventListener('click', () => d.close());
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); }); // backdrop
  d.addEventListener('close', () => { const r = returnTo; returnTo = null; r?.(); });
  document.body.append(d);
  return d;
}

export function openShortcuts(onClose?: () => void) {
  dialog ||= build();
  if (dialog.open) return;
  returnTo = onClose || null;
  dialog.showModal();
  dialog.focus(); // focus the sheet itself, not the close button
}
export function closeShortcuts() { dialog?.open && dialog.close(); }
export function destroyShortcuts() { dialog?.remove(); dialog = null; }
