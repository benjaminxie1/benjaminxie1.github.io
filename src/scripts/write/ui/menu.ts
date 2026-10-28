// Overflow (⋯) menu: role=menu, arrow keys, Esc / outside click to close.
import { h } from './dom';

export type MenuItem =
  | { label: string; hint?: string; run: () => void; disabled?: boolean; danger?: boolean; note?: string; checked?: boolean }
  | { sep: true }
  | { info: string };

export function attachMenu(button: HTMLButtonElement, build: () => MenuItem[]) {
  const menu = h('div', { class: 'menu', role: 'menu', 'aria-label': 'More actions', hidden: true });
  menu.id = 'more-menu';
  button.setAttribute('aria-controls', menu.id);
  button.after(menu);
  const items = () => [...menu.querySelectorAll<HTMLButtonElement>('[role^=menuitem]:not([disabled])')];

  function open(focusLast = false) {
    menu.replaceChildren();
    for (const it of build()) {
      if ('sep' in it) { menu.append(h('div', { class: 'menu-sep', role: 'separator' })); continue; }
      if ('info' in it) { menu.append(h('div', { class: 'menu-info', text: it.info })); continue; }
      const check = it.checked !== undefined;
      const b = h('button', { type: 'button', role: check ? 'menuitemcheckbox' : 'menuitem', 'aria-checked': check ? String(!!it.checked) : undefined, tabindex: '-1', class: 'menu-item' + (it.danger ? ' danger' : '') + (check ? ' is-check' : ''), disabled: !!it.disabled },
        h('span', { class: 'mi-l' }, h('span', { text: it.label }), it.note ? h('span', { class: 'mi-note', text: it.note }) : null),
        it.hint ? h('kbd', { text: it.hint }) : null,
      );
      b.addEventListener('click', () => { close(); it.run(); });
      menu.append(b);
    }
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    const list = items();
    (focusLast ? list[list.length - 1] : list[0])?.focus();
    setTimeout(() => document.addEventListener('pointerdown', outside), 0);
  }
  function close(refocus = false) {
    if (menu.hidden) return;
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside);
    if (refocus) button.focus();
  }
  const outside = (e: Event) => { if (!menu.contains(e.target as Node) && e.target !== button && !button.contains(e.target as Node)) close(); };

  button.addEventListener('click', () => (menu.hidden ? open() : close()));
  button.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); open(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); open(true); }
  });
  menu.addEventListener('keydown', (e) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); list[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); list[list.length - 1]?.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(true); }
    else if (e.key === 'Tab') close();
  });
  return { close };
}
