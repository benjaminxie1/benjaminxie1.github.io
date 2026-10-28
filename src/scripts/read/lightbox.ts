/**
 * Click (or Enter/Space) an image in a post to see it large. One <dialog> for the
 * whole post: Esc / click outside / × closes; ← → step through the post's images.
 * Works with any figure markup (size classes, galleries) since it only looks at <img>.
 * Opt out per image with data-nozoom on the img or any ancestor; linked images keep their link.
 */
export function initLightbox(body: HTMLElement) {
  const imgs = [...body.querySelectorAll<HTMLImageElement>('img')].filter(
    (img) => !img.closest('a, button, [data-nozoom], .embed, .read-lightbox'),
  );
  if (!imgs.length) return;

  const dlg = document.createElement('dialog');
  dlg.className = 'read-lightbox';
  dlg.setAttribute('aria-label', 'Image viewer');
  dlg.innerHTML = `
    <figure class="read-lb-figure">
      <img class="read-lb-img" alt="" />
      <figcaption class="read-lb-cap"></figcaption>
    </figure>
    <button type="button" class="read-lb-btn read-lb-close" aria-label="Close image">×</button>
    <button type="button" class="read-lb-btn read-lb-prev" aria-label="Previous image">‹</button>
    <button type="button" class="read-lb-btn read-lb-next" aria-label="Next image">›</button>
    <p class="read-lb-count" aria-live="polite"></p>`;
  document.body.append(dlg);
  const big = dlg.querySelector<HTMLImageElement>('.read-lb-img')!;
  const cap = dlg.querySelector<HTMLElement>('.read-lb-cap')!;
  const count = dlg.querySelector<HTMLElement>('.read-lb-count')!;
  const prev = dlg.querySelector<HTMLButtonElement>('.read-lb-prev')!;
  const next = dlg.querySelector<HTMLButtonElement>('.read-lb-next')!;
  const many = imgs.length > 1;
  prev.hidden = next.hidden = count.hidden = !many;
  let index = 0;
  let opener: HTMLElement | null = null;

  const show = (i: number) => {
    index = (i + imgs.length) % imgs.length;
    const img = imgs[index];
    big.removeAttribute('srcset');
    big.removeAttribute('sizes');
    // the largest candidate the page already knows about (responsive images pick it via sizes=100vw)
    if (img.srcset) {
      big.srcset = img.srcset;
      big.sizes = '100vw';
    }
    big.src = img.currentSrc || img.src;
    big.alt = img.alt;
    const fc = img.closest('figure')?.querySelector(':scope > figcaption');
    cap.textContent = fc?.textContent?.trim() || '';
    cap.hidden = !cap.textContent;
    count.textContent = many ? `${index + 1} / ${imgs.length}` : '';
  };
  const open = (i: number) => {
    opener = imgs[i];
    show(i);
    document.documentElement.classList.add('read-lb-open');
    dlg.showModal();
    dlg.querySelector<HTMLButtonElement>('.read-lb-close')!.focus({ preventScroll: true });
  };
  const close = () => dlg.open && dlg.close();

  dlg.addEventListener('close', () => {
    document.documentElement.classList.remove('read-lb-open');
    // return focus to the image you'd been looking at (it may have changed via ← →)
    (imgs[index] ?? opener)?.focus({ preventScroll: true });
  });
  dlg.addEventListener('click', (e) => {
    const t = e.target as Element;
    if (t.closest('.read-lb-prev')) return show(index - 1);
    if (t.closest('.read-lb-next')) return show(index + 1);
    // anything but the picture itself closes (backdrop, caption, ×)
    if (t !== big) close();
  });
  dlg.addEventListener('keydown', (e) => {
    if (!many) return;
    if (e.key === 'ArrowLeft') (e.preventDefault(), show(index - 1));
    else if (e.key === 'ArrowRight') (e.preventDefault(), show(index + 1));
  });

  imgs.forEach((img, i) => {
    img.classList.add('read-zoomable');
    img.tabIndex = 0;
    img.setAttribute('role', 'button');
    img.setAttribute('aria-haspopup', 'dialog');
    img.setAttribute('aria-label', img.alt ? `${img.alt} (enlarge)` : 'Enlarge image');
    img.addEventListener('click', () => open(i));
    img.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open(i);
      }
    });
  });
}
