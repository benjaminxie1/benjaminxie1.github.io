/**
 * Footnote previews: hover or focus a footnote number to read the note in place;
 * on touch, the first tap previews and a second tap jumps to the Notes section.
 * The Notes section at the bottom stays as it is.
 */
export function initFootnotes(body: HTMLElement) {
  const refs = [...body.querySelectorAll<HTMLAnchorElement>('a[data-footnote-ref]')];
  if (!refs.length) return;

  const pop = document.createElement('div');
  pop.className = 'read-fn-pop';
  pop.id = 'read-fn-pop';
  pop.setAttribute('role', 'tooltip');
  pop.hidden = true;
  document.body.append(pop);

  let active: HTMLAnchorElement | null = null;
  let showTimer = 0;
  let hideTimer = 0;
  let lastPointer = 'mouse';

  const noteFor = (a: HTMLAnchorElement) => {
    const id = decodeURIComponent(a.hash.slice(1));
    return id ? document.getElementById(id) : null;
  };

  const place = (a: HTMLAnchorElement) => {
    const r = a.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const w = Math.min(360, vw - 32);
    pop.style.width = `${w}px`;
    const left = Math.max(16, Math.min(r.left + r.width / 2 - w / 2, vw - w - 16));
    const h = pop.offsetHeight;
    const below = r.bottom + 10;
    const above = r.top - 10 - h;
    const top = below + h > window.innerHeight - 12 && above > 12 ? above : below;
    pop.dataset.side = top === below ? 'below' : 'above';
    pop.style.left = `${left + window.scrollX}px`;
    pop.style.top = `${top + window.scrollY}px`;
    pop.style.setProperty('--arrow-x', `${r.left + r.width / 2 - left}px`);
  };

  const show = (a: HTMLAnchorElement) => {
    window.clearTimeout(hideTimer);
    const note = noteFor(a);
    if (!note) return;
    if (active !== a) {
      hide(true);
      const clone = note.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('[data-footnote-backref]').forEach((b) => b.remove());
      clone.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
      pop.innerHTML = '';
      const num = document.createElement('span');
      num.className = 'read-fn-num';
      num.textContent = a.textContent || '';
      num.setAttribute('aria-hidden', 'true');
      const content = document.createElement('div');
      content.className = 'read-fn-body';
      content.append(...clone.childNodes);
      pop.append(num, content);
      active = a;
      a.setAttribute('aria-describedby', 'read-fn-pop');
      a.setAttribute('aria-expanded', 'true');
    }
    pop.hidden = false;
    place(a);
  };

  function hide(now = false) {
    window.clearTimeout(showTimer);
    window.clearTimeout(hideTimer);
    const go = () => {
      pop.hidden = true;
      if (active) {
        active.setAttribute('aria-describedby', 'footnote-label');
        active.removeAttribute('aria-expanded');
      }
      active = null;
    };
    if (now) go();
    else hideTimer = window.setTimeout(go, 220);
  }

  for (const a of refs) {
    a.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'mouse') return;
      window.clearTimeout(showTimer);
      window.clearTimeout(hideTimer);
      showTimer = window.setTimeout(() => show(a), active ? 0 : 120);
    });
    a.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') hide();
    });
    a.addEventListener('pointerdown', (e) => (lastPointer = e.pointerType));
    a.addEventListener('focus', () => {
      if (a.matches(':focus-visible')) show(a);
    });
    a.addEventListener('blur', () => hide());
    a.addEventListener('click', (e) => {
      // touch / pen: first tap previews, second tap follows the link to the note
      if (lastPointer !== 'mouse' && active !== a) {
        e.preventDefault();
        show(a);
      } else {
        hide(true);
      }
      lastPointer = 'mouse';
    });
  }
  pop.addEventListener('pointerenter', () => window.clearTimeout(hideTimer));
  pop.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') hide();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && active) {
      const a = active;
      hide(true);
      if (document.activeElement !== a) a.focus({ preventScroll: true });
    }
  });
  document.addEventListener('pointerdown', (e) => {
    const t = e.target as Element;
    if (active && !pop.contains(t) && !t.closest('a[data-footnote-ref]')) hide(true);
  });
  window.addEventListener('resize', () => active && place(active));
}
