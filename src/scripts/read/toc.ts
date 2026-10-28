/** Contents: open as a sticky margin rail on wide screens, and mark the section being read. */
export function initToc(nav: HTMLElement | null, body: HTMLElement) {
  if (!nav) return;
  const details = nav.querySelector('details');
  const wide = window.matchMedia('(min-width: 1200px)');
  const sync = () => {
    nav.classList.toggle('is-rail', wide.matches);
    if (details) details.open = wide.matches;
  };
  sync();
  wide.addEventListener('change', sync);

  // on the inline (collapsible) version, jumping to a section folds it back up
  nav.addEventListener('click', (e) => {
    if ((e.target as Element).closest('a') && details && !wide.matches) details.open = false;
  });

  const links = [...nav.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')];
  const pairs = links
    .map((a) => ({ a, h: document.getElementById(decodeURIComponent(a.hash.slice(1))) }))
    .filter((p): p is { a: HTMLAnchorElement; h: HTMLElement } => !!p.h && body.contains(p.h));
  if (!pairs.length) return;
  let current: HTMLAnchorElement | null = null;
  let queued = false;
  const update = () => {
    queued = false;
    const line = window.innerHeight * 0.3;
    let hit: HTMLAnchorElement | null = null;
    for (const p of pairs) {
      if (p.h.getBoundingClientRect().top <= line) hit = p.a;
      else break;
    }
    // past the end of the post: nothing is "current"
    if (body.getBoundingClientRect().bottom < line) hit = null;
    if (hit === current) return;
    current?.removeAttribute('aria-current');
    hit?.setAttribute('aria-current', 'location');
    current = hit;
  };
  const queue = () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(update);
    }
  };
  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', queue);
  update();
}
