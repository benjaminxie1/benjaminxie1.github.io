import { copyText } from './clipboard';

/** A "#" beside each section heading: click to jump there and copy its link. */
export function initAnchors(body: HTMLElement) {
  for (const h of body.querySelectorAll<HTMLHeadingElement>(':scope > h2[id], :scope > h3[id], :scope > h4[id]')) {
    if (h.classList.contains('sr-only')) continue;
    const a = document.createElement('a');
    a.className = 'read-anchor';
    a.href = `#${encodeURIComponent(h.id)}`;
    a.textContent = '#';
    a.setAttribute('aria-label', `Copy link to “${h.textContent?.trim() ?? 'section'}”`);
    a.title = 'Copy link to this section';
    a.addEventListener('click', async (e) => {
      e.preventDefault();
      history.replaceState(null, '', a.hash);
      h.scrollIntoView({ block: 'start' });
      const ok = await copyText(a.href);
      if (!ok) return;
      a.dataset.copied = '';
      window.setTimeout(() => delete a.dataset.copied, 1600);
    });
    h.append(a);
  }
}
