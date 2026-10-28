import { copyText } from './clipboard';

/** A quiet "Copy" button on each code block (shown on hover / focus). */
export function initCodeCopy(body: HTMLElement) {
  for (const pre of body.querySelectorAll<HTMLPreElement>('pre')) {
    if (pre.parentElement?.classList.contains('read-code')) continue;
    const wrap = document.createElement('div');
    wrap.className = 'read-code';
    pre.before(wrap);
    wrap.append(pre);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'read-copy';
    btn.textContent = 'Copy';
    btn.setAttribute('aria-label', 'Copy code');
    const status = document.createElement('span');
    status.className = 'sr-only';
    status.setAttribute('role', 'status');
    let t = 0;
    btn.addEventListener('click', async () => {
      const text = (pre.querySelector('code') ?? pre).textContent ?? '';
      const ok = await copyText(text.replace(/\n$/, ''));
      btn.textContent = ok ? 'Copied' : 'Press ⌘C';
      status.textContent = ok ? 'Code copied' : '';
      btn.dataset.done = '';
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        btn.textContent = 'Copy';
        status.textContent = '';
        delete btn.dataset.done;
      }, 1800);
    });
    wrap.append(btn, status);
  }
}
