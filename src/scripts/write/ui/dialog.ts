// Accessible dialogs on native <dialog>. Never window.prompt/confirm/alert.
// - Esc and a backdrop click dismiss (resolve null) unless dismissable: false
// - focus goes to the first field (or the safest button), and returns to the opener on close
// - buttons name their outcome; an action's run() may keep the dialog open (return false)
import { h, icon, id } from './dom';
import { dismiss as dismissToast } from './toast';

export type Action = {
  label: string;
  value: string;
  kind?: 'primary' | 'danger' | 'ghost' | 'quiet';
  disabled?: boolean;
  /** Runs on click. Throw or return false to keep the dialog open. */
  run?: (ctl: DialogCtl) => unknown | Promise<unknown>;
  busyLabel?: string;
};
export type DialogCtl = {
  el: HTMLDialogElement;
  body: HTMLElement;
  buttons: Record<string, HTMLButtonElement>;
  close(value: string | null): void;
  error(msg: string | null): void;
  busy(on: boolean): void;
};
export type DialogOpts = {
  title: string;
  description?: string;
  body?: Node | Node[];
  actions?: Action[];
  size?: 'sm' | 'md' | 'lg' | 'side';
  focus?: string | HTMLElement;
  dismissable?: boolean;
  className?: string;
};

export function openDialog(o: DialogOpts): { ctl: DialogCtl; result: Promise<string | null> } {
  const opener = document.activeElement as HTMLElement | null;
  const tid = id('dlg-t'), did = id('dlg-d');
  const dismissable = o.dismissable !== false;
  const el = h('dialog', {
    class: `dlg dlg-${o.size || 'md'} ${o.className || ''}`,
    'aria-labelledby': tid,
    'aria-describedby': o.description ? did : undefined,
  });
  const body = h('div', { class: 'dlg-body' });
  ([] as Node[]).concat(o.body || []).forEach((n) => body.append(n));
  const err = h('p', { class: 'dlg-err', role: 'alert', hidden: true });
  const foot = h('div', { class: 'dlg-actions' });
  const buttons: Record<string, HTMLButtonElement> = {};
  let resolve!: (v: string | null) => void;
  const result = new Promise<string | null>((r) => (resolve = r));
  let closed = false;
  let isBusy = false;

  const ctl: DialogCtl = {
    el, body, buttons,
    close(v) {
      if (closed) return;
      closed = true;
      el.close();
      el.remove();
      resolve(v);
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    },
    error(msg) { err.hidden = !msg; err.textContent = msg || ''; },
    busy(on) {
      isBusy = on;
      el.classList.toggle('is-busy', on);
      Object.values(buttons).forEach((b) => { if (on) { b.dataset.wasDisabled = b.disabled ? '1' : ''; b.disabled = true; } else b.disabled = b.dataset.wasDisabled === '1'; });
    },
  };

  for (const a of o.actions || []) {
    const b = h('button', { type: 'button', class: `btn btn-${a.kind || 'ghost'}`, text: a.label, disabled: !!a.disabled });
    b.addEventListener('click', async () => {
      if (isBusy) return;
      if (!a.run) return ctl.close(a.value);
      ctl.error(null);
      const label = b.textContent;
      ctl.busy(true);
      if (a.busyLabel) b.textContent = a.busyLabel;
      let keep = false;
      try { keep = (await a.run(ctl)) === false; }
      catch (e) { keep = true; ctl.error((e as Error).message || 'Something went wrong'); }
      if (closed) return;
      b.textContent = label;
      ctl.busy(false);
      if (!keep) ctl.close(a.value);
    });
    buttons[a.value] = b;
    foot.append(b);
  }

  const x = h('button', { type: 'button', class: 'dlg-x', 'aria-label': 'Close', title: 'Close (Esc)' }, icon('close', 18));
  x.addEventListener('click', () => !isBusy && ctl.close(null));
  const inner = h('div', { class: 'dlg-in' },
    h('div', { class: 'dlg-head' }, h('h2', { id: tid, text: o.title }), dismissable ? x : null),
    o.description ? h('p', { id: did, class: 'dlg-desc', text: o.description }) : null,
    body, err,
    o.actions?.length ? foot : null,
  );
  el.append(inner);

  el.addEventListener('cancel', (e) => { e.preventDefault(); if (dismissable && !isBusy) ctl.close(null); });
  el.addEventListener('mousedown', (e) => { (el as any)._downOnBackdrop = e.target === el; });
  el.addEventListener('click', (e) => { if (e.target === el && (el as any)._downOnBackdrop && dismissable && !isBusy) ctl.close(null); });

  dismissToast(); // a toast must never sit on top of a decision
  document.body.append(el);
  el.showModal();
  const target = typeof o.focus === 'string' ? el.querySelector<HTMLElement>(o.focus)
    : o.focus || el.querySelector<HTMLElement>('.dlg-body input:not([type=hidden]):not([disabled]), .dlg-body textarea, .dlg-body select')
      || foot.querySelector<HTMLElement>('.btn-ghost, .btn-quiet') || foot.querySelector<HTMLElement>('button') || x;
  target?.focus();
  return { ctl, result };
}

/** Yes/no with buttons that name the outcome. */
export async function confirmDialog(o: { title: string; message: string | Node; confirm: string; cancel?: string; danger?: boolean }): Promise<boolean> {
  const body = typeof o.message === 'string' ? h('p', { text: o.message }) : o.message;
  const { result } = openDialog({
    title: o.title, size: 'sm', body,
    actions: [
      { label: o.cancel || 'Cancel', value: 'no', kind: 'ghost' },
      { label: o.confirm, value: 'yes', kind: o.danger ? 'danger' : 'primary' },
    ],
  });
  return (await result) === 'yes';
}

/** Pick one of several named outcomes; null when dismissed. */
export async function choose(o: { title: string; message: string | Node; options: { label: string; value: string; kind?: Action['kind'] }[]; size?: DialogOpts['size'] }) {
  const body = typeof o.message === 'string' ? h('p', { text: o.message }) : o.message;
  return openDialog({ title: o.title, size: o.size || 'sm', body, actions: o.options.map((x) => ({ ...x })) }).result;
}
