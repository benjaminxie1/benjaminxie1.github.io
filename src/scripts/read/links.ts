/** Links that leave the site never get a handle on this page. */
export function initLinks(body: HTMLElement) {
  for (const a of body.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    if (a.origin === location.origin || !/^https?:$/.test(a.protocol)) continue;
    const rel = new Set((a.getAttribute('rel') || '').split(/\s+/).filter(Boolean));
    rel.add('noopener');
    a.setAttribute('rel', [...rel].join(' '));
    a.classList.add('read-ext');
  }
}
